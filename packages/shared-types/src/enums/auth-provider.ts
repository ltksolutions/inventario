/**
 * Authentication provider used for user login.
 *
 * Inventario supports multiple auth providers per ADR-0013.
 * Each user can have one or more linked providers via `authProviders[]`.
 * Tenants can restrict allowed providers via `Organisation.allowedAuthProviders`.
 */
export const AuthProvider = {
  /** Google OAuth 2.0 (personal or Google Workspace accounts). */
  GOOGLE: 'GOOGLE',
  /** Apple Sign-In (personal Apple ID). */
  APPLE: 'APPLE',
  /** Microsoft Entra ID / Microsoft Account (personal or work accounts). */
  MICROSOFT: 'MICROSOFT',
  /** Email + password (local account, argon2id hash). */
  EMAIL: 'EMAIL',
} as const;

export type AuthProvider = (typeof AuthProvider)[keyof typeof AuthProvider];

export const AUTH_PROVIDER_VALUES = Object.values(AuthProvider) as readonly AuthProvider[];

/**
 * Policy for how new members join an existing organisation.
 *
 * Self-serve registration creates NEW organisations (first user = ADMIN).
 * Joining EXISTING organisations is governed by this policy.
 *
 * See ADR-0013 §Invite flow.
 */
export const MemberJoinPolicy = {
  /** Only invited users can join. Default and most secure. */
  INVITE_ONLY: 'INVITE_ONLY',
  /** Users with matching email domain auto-join (e.g. @mestopezinok.sk). */
  DOMAIN_RESTRICTED: 'DOMAIN_RESTRICTED',
  /** Anyone with the org's join link can register. For clubs, communities. */
  OPEN: 'OPEN',
} as const;

export type MemberJoinPolicy = (typeof MemberJoinPolicy)[keyof typeof MemberJoinPolicy];

export const MEMBER_JOIN_POLICY_VALUES = Object.values(
  MemberJoinPolicy,
) as readonly MemberJoinPolicy[];

/**
 * How the organisation was initially created.
 */
export const RegistrationMethod = {
  /** Created via self-serve registration from pricing page. */
  SELF_SERVE: 'SELF_SERVE',
  /** Created manually (e.g. by platform admin, or legacy JIT provisioning). */
  MANUAL: 'MANUAL',
} as const;

export type RegistrationMethod = (typeof RegistrationMethod)[keyof typeof RegistrationMethod];

export const REGISTRATION_METHOD_VALUES = Object.values(
  RegistrationMethod,
) as readonly RegistrationMethod[];
