/**
 * GitHub OAuth helpers — no external dependencies, uses node:crypto.
 *
 * Flow:
 * 1. Redirect user to GitHub → getGithubAuthUrl()
 * 2. GitHub redirects back with code → exchangeCodeForUser()
 * 3. Check allowlist → isUserAllowed()
 * 4. Issue signed JWT → createDashboardJwt()
 * 5. Future requests: verify JWT → verifyDashboardJwt()
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface GithubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
}

export interface JwtPayload {
  sub: string;
  login: string;
  name: string | null;
  avatar: string;
  exp: number;
}

// ── JWT (HS256, node:crypto only) ────────────────────────

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function jwtSecret(): string {
  const s = process.env['GITHUB_OAUTH_SECRET'];
  if (!s) throw new Error('GITHUB_OAUTH_SECRET env var is required for JWT signing');
  return s;
}

export function createDashboardJwt(user: GithubUser): string {
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(Buffer.from(JSON.stringify({
    sub: String(user.id),
    login: user.login,
    name: user.name,
    avatar: user.avatar_url,
    exp: Math.floor(Date.now() / 1000) + 86_400, // 24h
  })));
  const sig = createHmac('sha256', jwtSecret()).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyDashboardJwt(token: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts as [string, string, string];

  let secret: string;
  try { secret = jwtSecret(); } catch { return null; }

  const expectedSig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  const sigBuf = Buffer.from(sig, 'base64url');
  const expBuf = Buffer.from(expectedSig, 'base64url');
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;

  let parsed: JwtPayload;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString()) as JwtPayload;
  } catch {
    return null;
  }

  if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
  return parsed;
}

// ── GitHub OAuth ──────────────────────────────────────────

export function isGithubOauthConfigured(): boolean {
  return !!(process.env['GITHUB_CLIENT_ID'] && process.env['GITHUB_CLIENT_SECRET']);
}

export function getGithubAuthUrl(state: string, redirectUri: string): string {
  const clientId = process.env['GITHUB_CLIENT_ID'];
  if (!clientId) throw new Error('GITHUB_CLIENT_ID env var not set');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'read:user',
    state,
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}

export async function exchangeCodeForUser(code: string): Promise<GithubUser> {
  const clientId = process.env['GITHUB_CLIENT_ID'];
  const clientSecret = process.env['GITHUB_CLIENT_SECRET'];
  if (!clientId || !clientSecret) throw new Error('GitHub OAuth not configured');

  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
  });
  if (!tokenRes.ok) throw new Error(`GitHub token exchange failed: ${tokenRes.status}`);

  const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
  if (!tokenData.access_token) {
    throw new Error(`GitHub OAuth error: ${tokenData.error ?? 'no access_token'}`);
  }

  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      'User-Agent': 'mcp-llm-bridge',
      Accept: 'application/vnd.github+json',
    },
  });
  if (!userRes.ok) throw new Error(`GitHub user fetch failed: ${userRes.status}`);

  return userRes.json() as Promise<GithubUser>;
}

export function isUserAllowed(login: string): boolean {
  const allowed = process.env['GITHUB_ALLOWED_USERS'];
  if (!allowed) return true; // no allowlist → any GitHub user can access
  return allowed.split(',').map(u => u.trim()).includes(login);
}
