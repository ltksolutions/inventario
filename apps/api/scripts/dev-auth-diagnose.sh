#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
# SPDX-License-Identifier: EUPL-1.2

# ============================================================================
# Diagnostic: get an Entra ID token, decode it, print key claims and call
# the protected API. Prints WHAT the server sees and WHY it might reject.
#
# Useful for debugging "Token signing key not found in JWKS" or similar
# verification failures.
#
# Usage:  bash apps/api/scripts/dev-auth-diagnose.sh
# ============================================================================

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../.env.local"
API_BASE="${API_BASE:-http://localhost:3000}"

if ! command -v jq >/dev/null 2>&1; then
  echo "❌ jq not installed. Run: brew install jq"
  exit 1
fi
if ! command -v python3 >/dev/null 2>&1; then
  echo "❌ python3 not found (should be in macOS by default)"
  exit 1
fi

TENANT_ID=$(grep -E '^ENTRA_TENANT_ID=' "$ENV_FILE" | cut -d= -f2-)
API_CLIENT_ID=$(grep -E '^ENTRA_API_CLIENT_ID=' "$ENV_FILE" | cut -d= -f2-)
CLI_CLIENT_ID=$(grep -E '^ENTRA_CLI_CLIENT_ID=' "$ENV_FILE" | cut -d= -f2-)

if [ -z "$TENANT_ID" ] || [ -z "$API_CLIENT_ID" ] || [ -z "$CLI_CLIENT_ID" ]; then
  echo "❌ Missing env vars in $ENV_FILE (need ENTRA_TENANT_ID, ENTRA_API_CLIENT_ID, ENTRA_CLI_CLIENT_ID)"
  exit 1
fi

# ----- 1. DEVICE CODE -----
echo "📞 Requesting device code…"
DC_RESP=$(curl -s -X POST \
  "https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/devicecode" \
  -d "client_id=${CLI_CLIENT_ID}" \
  -d "scope=api://${API_CLIENT_ID}/access_as_user openid profile email")

USER_CODE=$(echo "$DC_RESP" | jq -r '.user_code // empty')
DEVICE_CODE=$(echo "$DC_RESP" | jq -r '.device_code // empty')
VERIFICATION_URI=$(echo "$DC_RESP" | jq -r '.verification_uri // empty')

if [ -z "$DEVICE_CODE" ]; then
  echo "❌ Device code request failed:"
  echo "$DC_RESP" | jq
  exit 1
fi

echo ""
echo "════════════════════════════════════════"
echo "🔐 SIGN IN"
echo "   1. Open: $VERIFICATION_URI"
echo "   2. Enter code: $USER_CODE"
echo "════════════════════════════════════════"
echo ""

# ----- 2. POLL FOR TOKEN -----
TOKEN=""
for i in $(seq 1 180); do
  TR=$(curl -s -X POST \
    "https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token" \
    -d "grant_type=urn:ietf:params:oauth:grant-type:device_code" \
    -d "client_id=${CLI_CLIENT_ID}" \
    -d "device_code=${DEVICE_CODE}")
  TOKEN=$(echo "$TR" | jq -r '.access_token // empty')
  if [ -n "$TOKEN" ]; then
    echo "✓ Token received."
    break
  fi
  ERR=$(echo "$TR" | jq -r '.error // empty')
  if [ "$ERR" != "authorization_pending" ] && [ "$ERR" != "slow_down" ]; then
    echo "❌ Token endpoint error: $ERR"
    echo "$TR" | jq
    exit 1
  fi
  printf "\r⏳ Waiting… (%d)   " "$i"
  sleep 5
done

if [ -z "$TOKEN" ]; then
  echo "❌ Timed out."
  exit 1
fi

# ----- 3. DECODE HEADER + PAYLOAD via python3 (handles base64url padding) -----
echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "🔍 JWT HEADER (algorithm + key ID)"
echo "═══════════════════════════════════════════════════════════════════"
python3 -c "
import sys, base64, json
token = '$TOKEN'
header = token.split('.')[0]
# Pad base64url to base64
header += '=' * (-len(header) % 4)
decoded = base64.urlsafe_b64decode(header)
data = json.loads(decoded)
print(json.dumps(data, indent=2))
"

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "🔍 JWT PAYLOAD (key claims, redacted)"
echo "═══════════════════════════════════════════════════════════════════"
python3 -c "
import sys, base64, json, time
token = '$TOKEN'
payload = token.split('.')[1]
payload += '=' * (-len(payload) % 4)
decoded = base64.urlsafe_b64decode(payload)
data = json.loads(decoded)
out = {
  'iss':   data.get('iss'),
  'aud':   data.get('aud'),
  'ver':   data.get('ver'),
  'scp':   data.get('scp'),
  'appid': data.get('appid'),
  'tid':   data.get('tid'),
  'has_oid':   'oid' in data,
  'has_email': bool(data.get('email') or data.get('preferred_username')),
  'exp_utc':   time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime(data['exp'])) if 'exp' in data else None,
}
print(json.dumps(out, indent=2))
"

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "🔍 WHAT THE SERVER EXPECTS"
echo "═══════════════════════════════════════════════════════════════════"
echo "Expected issuer: https://login.microsoftonline.com/${TENANT_ID}/v2.0"
echo "Expected aud:    ${API_CLIENT_ID}  OR  api://${API_CLIENT_ID}"
echo "Expected ver:    2.0"
echo "Expected scp:    contains 'access_as_user'"

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "🔍 JWKS ENDPOINT — what keys does Microsoft publish?"
echo "═══════════════════════════════════════════════════════════════════"
JWKS_URI="https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys"
echo "Fetching $JWKS_URI"
KIDS=$(curl -s "$JWKS_URI" | jq -r '.keys[].kid' | head -20)
echo "Available kids (first 20):"
echo "$KIDS"

echo ""
echo "Token's kid is at the top of the JWT HEADER output above."
echo "Check: is the token's kid present in the list above?"

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "🚀 CALL API"
echo "═══════════════════════════════════════════════════════════════════"
echo "GET $API_BASE/v1/me"
curl -s -w "\nHTTP %{http_code}\n" "$API_BASE/v1/me" \
  -H "Authorization: Bearer ${TOKEN}" | jq 2>/dev/null || cat

echo ""
echo "═══════════════════════════════════════════════════════════════════"
echo "🎉 Diagnose complete. Send the WHOLE output above to Claude."
