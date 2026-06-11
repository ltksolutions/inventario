#!/usr/bin/env bash
# SPDX-FileCopyrightText: 2026 Ján Letko / LTK Solutions
# SPDX-License-Identifier: EUPL-1.2

# ============================================================================
# Local dev: get an Entra ID access token via OAuth 2.0 device code flow
# and exercise the protected API endpoints end-to-end.
#
# Usage:
#   1. Ensure `pnpm dev` is running in another terminal (apps/api).
#   2. Add this line to .env.local (with the CLI app's client ID from Azure):
#        ENTRA_CLI_CLIENT_ID=<guid>
#      (This is the CLI/test app registration, NOT the API one.)
#   3. Run from anywhere:  bash apps/api/scripts/dev-auth-test.sh
#
# Prereqs: jq, curl, a browser to complete the device login flow.
#
# Output is redacted: real _id / email never appear in full.
# ============================================================================

set -u

# ----- CONFIG (all from .env.local) -----
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/../.env.local"
API_BASE="${API_BASE:-http://localhost:3000}"

# ----- VALIDATE PREREQS -----
if [ ! -f "$ENV_FILE" ]; then
  echo "❌ Cannot find $ENV_FILE"
  exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
  echo "❌ jq not installed. Run: brew install jq"
  exit 1
fi

# ----- READ ENV VARS -----
TENANT_ID=$(grep -E '^ENTRA_TENANT_ID=' "$ENV_FILE" | cut -d= -f2-)
API_CLIENT_ID=$(grep -E '^ENTRA_API_CLIENT_ID=' "$ENV_FILE" | cut -d= -f2-)
CLI_CLIENT_ID=$(grep -E '^ENTRA_CLI_CLIENT_ID=' "$ENV_FILE" | cut -d= -f2-)

if [ -z "$TENANT_ID" ] || [ -z "$API_CLIENT_ID" ]; then
  echo "❌ ENTRA_TENANT_ID or ENTRA_API_CLIENT_ID missing in $ENV_FILE"
  exit 1
fi
if [ -z "$CLI_CLIENT_ID" ]; then
  echo "❌ ENTRA_CLI_CLIENT_ID missing in $ENV_FILE"
  echo ""
  echo "   Add this line (with your CLI app's Application (client) ID from Azure):"
  echo "     ENTRA_CLI_CLIENT_ID=<guid>"
  echo ""
  echo "   The CLI app is the public-client app registration you created for testing,"
  echo "   separate from the API app registration."
  exit 1
fi

echo "Tenant:  ${TENANT_ID:0:8}…"
echo "API:     ${API_CLIENT_ID:0:8}…"
echo "CLI:     ${CLI_CLIENT_ID:0:8}…"
echo "API URL: $API_BASE"

# ----- 1. DEVICE CODE -----
echo ""
echo "📞 Requesting device code…"
DEVICECODE_RESPONSE=$(curl -s -X POST \
  "https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/devicecode" \
  -d "client_id=${CLI_CLIENT_ID}" \
  -d "scope=api://${API_CLIENT_ID}/access_as_user openid profile email")

echo "$DEVICECODE_RESPONSE" | jq

USER_CODE=$(echo "$DEVICECODE_RESPONSE" | jq -r '.user_code // empty')
VERIFICATION_URI=$(echo "$DEVICECODE_RESPONSE" | jq -r '.verification_uri // empty')
DEVICE_CODE=$(echo "$DEVICECODE_RESPONSE" | jq -r '.device_code // empty')

if [ -z "$DEVICE_CODE" ]; then
  echo ""
  echo "❌ No device_code in response — check error fields above."
  echo "   Common causes:"
  echo "     - CLI app: 'Allow public client flows' is OFF (Azure → CLI app → Authentication)"
  echo "     - CLI app: missing API permission for 'access_as_user' on the API app"
  echo "     - Wrong CLI_CLIENT_ID or ENTRA_TENANT_ID"
  exit 1
fi

echo ""
echo "════════════════════════════════════════"
echo "🔐 SIGN IN STEP"
echo ""
echo "   1. Open in browser: $VERIFICATION_URI"
echo "   2. Enter code:      $USER_CODE"
echo "   3. Sign in with your SFZ Entra account"
echo "   4. Accept the consent prompt"
echo "════════════════════════════════════════"
echo ""
echo "The script will now poll Microsoft for the token every 5 seconds."
echo "You have up to 15 minutes to complete sign-in."
echo ""

# ----- 2. POLL FOR TOKEN -----
#
# Device code flow requires polling the token endpoint at the interval
# specified by Microsoft (typically 5 seconds). We get one of three results:
#   - access_token → success
#   - error: authorization_pending → keep polling
#   - error: anything else → stop and report

MAX_POLLS=180  # 180 polls × 5s = 15 minutes total
POLL_COUNT=0
TOKEN=""

while [ $POLL_COUNT -lt $MAX_POLLS ]; do
  POLL_COUNT=$((POLL_COUNT + 1))

  TOKEN_RESPONSE=$(curl -s -X POST \
    "https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token" \
    -d "grant_type=urn:ietf:params:oauth:grant-type:device_code" \
    -d "client_id=${CLI_CLIENT_ID}" \
    -d "device_code=${DEVICE_CODE}")

  TOKEN=$(echo "$TOKEN_RESPONSE" | jq -r '.access_token // empty')
  if [ -n "$TOKEN" ]; then
    # Success! Bail out of the polling loop.
    echo "✓ Token received after ${POLL_COUNT} poll(s)."
    break
  fi

  ERROR=$(echo "$TOKEN_RESPONSE" | jq -r '.error // empty')

  case "$ERROR" in
    authorization_pending)
      # User hasn't completed sign-in yet — keep waiting.
      # Use printf so we can overwrite the same line with the dot counter.
      printf "\r⏳ Waiting for sign-in\u2026 (poll %d/%d)   " "$POLL_COUNT" "$MAX_POLLS"
      sleep 5
      ;;
    slow_down)
      # Microsoft asks us to slow down — add 5s to interval.
      printf "\r🐢 Slowing down\u2026 (poll %d/%d)   " "$POLL_COUNT" "$MAX_POLLS"
      sleep 10
      ;;
    expired_token)
      echo ""
      echo "❌ Device code expired (15 min limit). Re-run the script to start over."
      exit 1
      ;;
    "")
      # No error field but also no token — shouldn't happen, but be defensive.
      echo ""
      echo "❌ Unexpected token response:"
      echo "$TOKEN_RESPONSE" | jq
      exit 1
      ;;
    *)
      # Any other error — print full response and stop.
      echo ""
      echo "❌ Token endpoint returned error: $ERROR"
      echo "$TOKEN_RESPONSE" | jq
      exit 1
      ;;
  esac
done

if [ -z "$TOKEN" ]; then
  echo ""
  echo "❌ Timed out after $MAX_POLLS polls (~15 min). Re-run if you want to retry."
  exit 1
fi

echo ""
echo "🎟️  Access token acquired."

# ----- 3. PEEK INSIDE TOKEN -----
#
# JWT payload is base64url-encoded (uses '-' and '_' instead of '+' and '/',
# and omits '=' padding). macOS `base64 -d` is strict and chokes on this
# — it occasionally truncates output silently, leaving jq with malformed
# JSON ("Unfinished JSON term at EOF"). Python's `base64.urlsafe_b64decode`
# handles it cleanly once we restore the missing padding.
echo ""
echo "📋 Token claims (redacted):"
TOKEN_PAYLOAD=$(echo "$TOKEN" | cut -d. -f2)
DECODED_PAYLOAD=$(python3 -c "
import base64, sys
raw = sys.argv[1]
raw += '=' * (-len(raw) % 4)  # restore base64 padding
sys.stdout.write(base64.urlsafe_b64decode(raw).decode('utf-8'))
" "$TOKEN_PAYLOAD")
echo "$DECODED_PAYLOAD" | jq '{
  iss,
  aud,
  ver,
  scp,
  has_oid: (.oid != null),
  has_email: ((.email // .preferred_username) != null),
  name_first_char: ((.name // "?") | .[0:1] + "…"),
  exp_utc: (.exp | strftime("%Y-%m-%d %H:%M:%S UTC"))
}'

# ----- 4. CALL API: /v1/me (FIRST CALL = JIT PROVISIONING) -----
echo ""
echo "🚀 GET /v1/me (first call — should JIT-provision)…"
ME_RESPONSE=$(curl -s -w "\n%{http_code}" "$API_BASE/v1/me" \
  -H "Authorization: Bearer ${TOKEN}")
ME_STATUS=$(echo "$ME_RESPONSE" | tail -n 1)
ME_BODY=$(echo "$ME_RESPONSE" | sed '$d')

if [ "$ME_STATUS" = "200" ]; then
  echo "$ME_BODY" | jq '. + {
    _id: ((._id // "") | .[0:4] + "…"),
    email: ((.email // "") | .[0:4] + "…")
  }'
else
  echo "❌ GET /v1/me failed with HTTP $ME_STATUS"
  echo "$ME_BODY" | jq '.' 2>/dev/null || echo "$ME_BODY"
  exit 1
fi

# ----- 5. IDEMPOTENCY CHECK -----
echo ""
echo "🔁 GET /v1/me again (idempotency check)…"
ME_BODY_2=$(curl -s "$API_BASE/v1/me" -H "Authorization: Bearer ${TOKEN}")
ID_1=$(echo "$ME_BODY" | jq -r '._id // empty')
ID_2=$(echo "$ME_BODY_2" | jq -r '._id // empty')

if [ -n "$ID_1" ] && [ "$ID_1" = "$ID_2" ]; then
  echo "✅ Same _id (${ID_1:0:4}…) returned on both calls — JIT is idempotent."
else
  echo "❌ _id mismatch! Call 1: ${ID_1:-<none>} / Call 2: ${ID_2:-<none>}"
fi

# ============================================================================
# 6. CRUD SMOKE TESTS — slice #2b (POST/PATCH/DELETE on /v1/assets)
# ============================================================================
#
# Exercises the full write path: RBAC → transaction → audit log.
#
# Uses dummy 24-char hex ObjectIds for categoryId/locationId because those
# collections aren't seeded yet (slice #3+ will introduce categories and
# locations endpoints). MongoDB doesn't enforce foreign keys, so dummy IDs
# pass schema validation and insert successfully.
#
# Cleanup: every successful run soft-deletes the assets it created, so the
# collection doesn't grow unbounded across reruns. Inventory sequence numbers
# still increase — that's by design (deleted numbers must not be reused).
# ============================================================================

echo ""
echo "════════════════════════════════════════"
echo "🧪 CRUD SMOKE TESTS (slice #2b)"
echo "════════════════════════════════════════"

# Dummy ObjectIds (24 hex chars each) for fields that reference unseeded collections.
DUMMY_CATEGORY_ID="000000000000000000000001"
DUMMY_LOCATION_ID="000000000000000000000002"

# Helper: print a colored status line.
pass() { echo "✅ $1"; }
fail() { echo "❌ $1"; }
step() { echo ""; echo "── $1"; }

# Track failures for exit code at the end.
FAILURES=0

# ----- 6.1 POST /v1/assets (first — expect inventoryNumber sequence +1) -----
step "POST /v1/assets (asset #1)"
POST_BODY_1='{
  "inventoryNumberPrefix": "TEST",
  "name": "Test laptop #1",
  "type": "IT",
  "categoryId": "'"$DUMMY_CATEGORY_ID"'",
  "condition": "NEW",
  "locationId": "'"$DUMMY_LOCATION_ID"'",
  "acquiredAt": "2026-01-15T00:00:00.000Z"
}'

POST_1_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/v1/assets" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$POST_BODY_1")
POST_1_STATUS=$(echo "$POST_1_RESPONSE" | tail -n 1)
POST_1_BODY=$(echo "$POST_1_RESPONSE" | sed '$d')

if [ "$POST_1_STATUS" = "201" ]; then
  ASSET_1_ID=$(echo "$POST_1_BODY" | jq -r '._id')
  ASSET_1_INV=$(echo "$POST_1_BODY" | jq -r '.inventoryNumber')
  pass "Created asset #1: $ASSET_1_INV (_id: ${ASSET_1_ID:0:8}…)"
else
  fail "POST #1 failed with HTTP $POST_1_STATUS"
  echo "$POST_1_BODY" | jq '.' 2>/dev/null || echo "$POST_1_BODY"
  FAILURES=$((FAILURES + 1))
fi

# ----- 6.2 POST /v1/assets (second — expect sequence +2) -----
step "POST /v1/assets (asset #2 — verifies inventory auto-increment)"
POST_BODY_2='{
  "inventoryNumberPrefix": "TEST",
  "name": "Test camera #2",
  "type": "MEDIA",
  "categoryId": "'"$DUMMY_CATEGORY_ID"'",
  "condition": "GOOD",
  "locationId": "'"$DUMMY_LOCATION_ID"'",
  "acquiredAt": "2026-02-20T00:00:00.000Z"
}'

POST_2_RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$API_BASE/v1/assets" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d "$POST_BODY_2")
POST_2_STATUS=$(echo "$POST_2_RESPONSE" | tail -n 1)
POST_2_BODY=$(echo "$POST_2_RESPONSE" | sed '$d')

if [ "$POST_2_STATUS" = "201" ]; then
  ASSET_2_ID=$(echo "$POST_2_BODY" | jq -r '._id')
  ASSET_2_INV=$(echo "$POST_2_BODY" | jq -r '.inventoryNumber')
  pass "Created asset #2: $ASSET_2_INV (_id: ${ASSET_2_ID:0:8}…)"

  # Verify the sequence number is asset_1's + 1
  SEQ_1=$(echo "$ASSET_1_INV" | awk -F- '{print $3}' | sed 's/^0*//')
  SEQ_2=$(echo "$ASSET_2_INV" | awk -F- '{print $3}' | sed 's/^0*//')
  EXPECTED_SEQ_2=$((SEQ_1 + 1))

  if [ "$SEQ_2" = "$EXPECTED_SEQ_2" ]; then
    pass "Inventory sequence is contiguous: $SEQ_1 → $SEQ_2"
  else
    fail "Inventory sequence broken: $SEQ_1 then $SEQ_2 (expected $EXPECTED_SEQ_2)"
    FAILURES=$((FAILURES + 1))
  fi
else
  fail "POST #2 failed with HTTP $POST_2_STATUS"
  echo "$POST_2_BODY" | jq '.' 2>/dev/null || echo "$POST_2_BODY"
  FAILURES=$((FAILURES + 1))
fi

# ----- 6.3 GET /v1/assets/:id (single asset lookup) -----
step "GET /v1/assets/:id (single asset lookup)"
if [ -n "${ASSET_1_ID:-}" ]; then
  GET_ONE_RESPONSE=$(curl -s -w "\n%{http_code}" "$API_BASE/v1/assets/$ASSET_1_ID" \
    -H "Authorization: Bearer ${TOKEN}")
  GET_ONE_STATUS=$(echo "$GET_ONE_RESPONSE" | tail -n 1)
  GET_ONE_BODY=$(echo "$GET_ONE_RESPONSE" | sed '$d')

  if [ "$GET_ONE_STATUS" = "200" ]; then
    GET_ONE_NAME=$(echo "$GET_ONE_BODY" | jq -r '.name')
    pass "Retrieved asset #1: \"$GET_ONE_NAME\""
  else
    fail "GET /:id failed with HTTP $GET_ONE_STATUS"
    FAILURES=$((FAILURES + 1))
  fi
else
  echo "(skipping — asset #1 was never created)"
fi

# ----- 6.4 PATCH /v1/assets/:id (update name, verify in response) -----
step "PATCH /v1/assets/:id (rename asset #1)"
if [ -n "${ASSET_1_ID:-}" ]; then
  NEW_NAME="Test laptop #1 (renamed at $(date +%H:%M:%S))"
  PATCH_BODY='{"name": "'"$NEW_NAME"'"}'

  PATCH_RESPONSE=$(curl -s -w "\n%{http_code}" -X PATCH "$API_BASE/v1/assets/$ASSET_1_ID" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$PATCH_BODY")
  PATCH_STATUS=$(echo "$PATCH_RESPONSE" | tail -n 1)
  PATCH_BODY_RESP=$(echo "$PATCH_RESPONSE" | sed '$d')

  if [ "$PATCH_STATUS" = "200" ]; then
    PATCH_NAME=$(echo "$PATCH_BODY_RESP" | jq -r '.name')
    if [ "$PATCH_NAME" = "$NEW_NAME" ]; then
      pass "Renamed asset #1 — new name reflected in response"
    else
      fail "PATCH returned 200 but name didn't update (got: $PATCH_NAME)"
      FAILURES=$((FAILURES + 1))
    fi
  else
    fail "PATCH failed with HTTP $PATCH_STATUS"
    echo "$PATCH_BODY_RESP" | jq '.' 2>/dev/null || echo "$PATCH_BODY_RESP"
    FAILURES=$((FAILURES + 1))
  fi
else
  echo "(skipping — asset #1 was never created)"
fi

# ----- 6.5 GET /v1/assets (list — verify both test assets present) -----
step "GET /v1/assets (list)"
LIST_RESPONSE=$(curl -s -w "\n%{http_code}" "$API_BASE/v1/assets?limit=100" \
  -H "Authorization: Bearer ${TOKEN}")
LIST_STATUS=$(echo "$LIST_RESPONSE" | tail -n 1)
LIST_BODY=$(echo "$LIST_RESPONSE" | sed '$d')

if [ "$LIST_STATUS" = "200" ]; then
  LIST_TOTAL=$(echo "$LIST_BODY" | jq -r '.pagination.total')
  pass "List endpoint returned total=$LIST_TOTAL asset(s)"
else
  fail "GET /v1/assets failed with HTTP $LIST_STATUS"
  echo "$LIST_BODY" | jq '.' 2>/dev/null || echo "$LIST_BODY"
  FAILURES=$((FAILURES + 1))
fi

# ----- 6.6 DELETE /v1/assets/:id (soft delete asset #2, verify 404 after) -----
step "DELETE /v1/assets/:id (asset #2)"
if [ -n "${ASSET_2_ID:-}" ]; then
  DEL_RESPONSE=$(curl -s -w "\n%{http_code}" -X DELETE "$API_BASE/v1/assets/$ASSET_2_ID" \
    -H "Authorization: Bearer ${TOKEN}")
  DEL_STATUS=$(echo "$DEL_RESPONSE" | tail -n 1)
  DEL_BODY=$(echo "$DEL_RESPONSE" | sed '$d')

  if [ "$DEL_STATUS" = "204" ]; then
    pass "DELETE returned 204 for asset #2"

    # Verify it's now gone: GET should return 404
    GET_DEL_RESPONSE=$(curl -s -w "\n%{http_code}" \
      "$API_BASE/v1/assets/$ASSET_2_ID" \
      -H "Authorization: Bearer ${TOKEN}")
    GET_DEL_STATUS=$(echo "$GET_DEL_RESPONSE" | tail -n 1)
    if [ "$GET_DEL_STATUS" = "404" ]; then
      pass "GET on deleted asset returns 404 (soft-delete works)"
    else
      fail "Expected 404 after delete, got HTTP $GET_DEL_STATUS"
      FAILURES=$((FAILURES + 1))
    fi
  else
    fail "DELETE failed with HTTP $DEL_STATUS"
    echo "$DEL_BODY" | jq '.' 2>/dev/null || echo "$DEL_BODY"
    FAILURES=$((FAILURES + 1))
  fi
else
  echo "(skipping — asset #2 was never created)"
fi

# ----- 6.7 Cleanup: delete asset #1 too (keep DB tidy across reruns) -----
step "Cleanup: DELETE asset #1"
if [ -n "${ASSET_1_ID:-}" ]; then
  CLEANUP_RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X DELETE "$API_BASE/v1/assets/$ASSET_1_ID" \
    -H "Authorization: Bearer ${TOKEN}")
  CLEANUP_STATUS=$(echo "$CLEANUP_RESPONSE" | tail -n 1)
  CLEANUP_BODY=$(echo "$CLEANUP_RESPONSE" | sed '$d')

  if [ "$CLEANUP_STATUS" = "204" ]; then
    pass "Cleanup OK"
  else
    fail "Cleanup DELETE got HTTP $CLEANUP_STATUS"
    echo "$CLEANUP_BODY" | jq '.' 2>/dev/null || echo "$CLEANUP_BODY"
    FAILURES=$((FAILURES + 1))
  fi
else
  echo "(skipping — asset #1 was never created)"
fi

# ----- 6.8 Summary -----
echo ""
echo "════════════════════════════════════════"
if [ "$FAILURES" = "0" ]; then
  echo "✅ ALL CRUD TESTS PASSED — slice #2b smoke tests green"
else
  echo "❌ $FAILURES test(s) failed — see output above"
fi
echo "════════════════════════════════════════"

echo ""
echo "🎉 Done."
exit "$FAILURES"
