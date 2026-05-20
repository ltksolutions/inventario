/**
 * Deprecated — Slice #6c K17.
 *
 * Test tokens are now Inventario JWTs issued directly by
 * `app.inventarioJwt.issueAccessToken(user, org)` inside `provisionUser()`.
 * This shim is kept so test files compile without immediate code changes;
 * it returns a no-op function that the deprecated `provisionUserAs` /
 * `provisionUserAsAndSignToken` wrappers in test-fixtures.ts ignore.
 *
 * TODO: Remove this file (and all `createTokenSigner()` call sites) once
 * every test file is migrated to `provisionUser()`.
 */
export async function createTokenSigner(): Promise<() => Promise<string>> {
  return async () => 'deprecated-shim-not-used';
}
