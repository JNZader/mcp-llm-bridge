import { timingSafeEqual } from 'node:crypto';
import { MIN_AUTH_TOKEN_LENGTH } from '../core/constants.js';

export const ADMIN_CREDENTIAL_KIND = {
  COOKIE: 'cookie',
  BEARER: 'bearer',
  NONE: 'none',
} as const;

export interface CookieAdminCredential {
  kind: typeof ADMIN_CREDENTIAL_KIND.COOKIE;
  encodedSession: string;
}

export interface BearerAdminCredential {
  kind: typeof ADMIN_CREDENTIAL_KIND.BEARER;
  token: string;
}

export interface NoAdminCredential {
  kind: typeof ADMIN_CREDENTIAL_KIND.NONE;
}

export type AdminCredentialMode =
  | CookieAdminCredential
  | BearerAdminCredential
  | NoAdminCredential;

export const AUTH_UNAVAILABLE_REASON = {
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  INVALID_STATIC_TOKEN: 'INVALID_STATIC_TOKEN',
  OAUTH_NOT_CONFIGURED: 'OAUTH_NOT_CONFIGURED',
  OAUTH_USER_DENIED: 'OAUTH_USER_DENIED',
} as const;

export type AuthUnavailableReason =
  (typeof AUTH_UNAVAILABLE_REASON)[keyof typeof AUTH_UNAVAILABLE_REASON];

export const ADMIN_AUTH_MODE = {
  STATIC: 'static',
  GITHUB_OAUTH: 'github_oauth',
} as const;

export type AdminAuthMode =
  (typeof ADMIN_AUTH_MODE)[keyof typeof ADMIN_AUTH_MODE];

export interface GithubOAuthConfig {
  clientId: string;
  clientSecret: string;
  allowedUsers: readonly string[];
}

export interface AuthRuntimeOptions {
  staticToken?: string;
  githubOAuth?: GithubOAuthConfig;
}

export interface AdminPublicAuthView {
  available: boolean;
  modes: readonly AdminAuthMode[];
}

export interface GithubOAuthPublicView {
  available: boolean;
}

export interface AuthRuntimePublicView {
  admin: AdminPublicAuthView;
  githubOAuth: GithubOAuthPublicView;
}

export interface AdminAuthorizationResult {
  authorized: boolean;
  reason?: AuthUnavailableReason;
}

export interface AdminSession {
  id: string;
  subject: string;
  expiresAt: number;
}

export interface AdminSessionStore {
  get(sessionId: string): AdminSession | undefined;
  revoke(sessionId: string): void;
}

export interface CredentialHeaders {
  authorization?: string;
  cookie?: string;
}

function readAdminSession(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;

  for (const segment of cookieHeader.split(';')) {
    const [name, ...value] = segment.trim().split('=');
    if (name === 'llm_gateway_admin') return value.join('=');
  }

  return undefined;
}

function readBearerToken(authorization: string | undefined): string | undefined {
  if (!authorization) return undefined;
  const match = /^Bearer[ \t]+([^\s]+)$/i.exec(authorization);
  return match?.[1];
}

export class AuthRuntime {
  readonly publicView: AuthRuntimePublicView;

  private readonly staticToken: string | undefined;
  private readonly githubOAuth: GithubOAuthConfig | undefined;

  constructor(options: AuthRuntimeOptions) {
    const staticToken = options.staticToken?.trim();
    this.staticToken = staticToken && staticToken.length >= MIN_AUTH_TOKEN_LENGTH ? staticToken : undefined;
    const githubOAuth = options.githubOAuth;
    this.githubOAuth = githubOAuth
      && githubOAuth.clientId.trim()
      && githubOAuth.clientSecret.trim()
      && githubOAuth.allowedUsers.some((user) => user.trim())
      ? { ...githubOAuth, allowedUsers: githubOAuth.allowedUsers.map((user) => user.trim()).filter(Boolean) }
      : undefined;

    const modes: AdminAuthMode[] = [];
    if (this.staticToken) modes.push(ADMIN_AUTH_MODE.STATIC);
    if (this.githubOAuth) modes.push(ADMIN_AUTH_MODE.GITHUB_OAUTH);

    this.publicView = {
      admin: { available: modes.length > 0, modes },
      githubOAuth: { available: this.githubOAuth !== undefined },
    };
  }

  selectCredential(headers: CredentialHeaders): AdminCredentialMode {
    const encodedSession = readAdminSession(headers.cookie);
    if (encodedSession !== undefined) {
      return { kind: ADMIN_CREDENTIAL_KIND.COOKIE, encodedSession };
    }

    const token = readBearerToken(headers.authorization);
    return token
      ? { kind: ADMIN_CREDENTIAL_KIND.BEARER, token }
      : { kind: ADMIN_CREDENTIAL_KIND.NONE };
  }

  authenticateStatic(token: string): AdminAuthorizationResult {
    if (!this.staticToken) {
      return { authorized: false, reason: AUTH_UNAVAILABLE_REASON.NOT_CONFIGURED };
    }

    const candidate = Buffer.from(token);
    const expected = Buffer.from(this.staticToken);
    return candidate.length === expected.length && timingSafeEqual(candidate, expected)
      ? { authorized: true }
      : { authorized: false, reason: AUTH_UNAVAILABLE_REASON.INVALID_STATIC_TOKEN };
  }

  authorizeGithubUser(login: string): AdminAuthorizationResult {
    if (!this.githubOAuth) {
      return { authorized: false, reason: AUTH_UNAVAILABLE_REASON.OAUTH_NOT_CONFIGURED };
    }

    return this.githubOAuth.allowedUsers.includes(login)
      ? { authorized: true }
      : { authorized: false, reason: AUTH_UNAVAILABLE_REASON.OAUTH_USER_DENIED };
  }
}

export const createAuthRuntime = (options: AuthRuntimeOptions): AuthRuntime => new AuthRuntime(options);
