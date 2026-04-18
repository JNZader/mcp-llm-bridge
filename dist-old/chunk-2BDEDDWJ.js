// src/auth/github-oauth.ts
import { createHmac, timingSafeEqual } from "crypto";
function b64url(buf) {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function jwtSecret() {
  const s = process.env["GITHUB_OAUTH_SECRET"];
  if (!s) throw new Error("GITHUB_OAUTH_SECRET env var is required for JWT signing");
  return s;
}
function createDashboardJwt(user) {
  const header = b64url(Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })));
  const body = b64url(Buffer.from(JSON.stringify({
    sub: String(user.id),
    login: user.login,
    name: user.name,
    avatar: user.avatar_url,
    exp: Math.floor(Date.now() / 1e3) + 86400
    // 24h
  })));
  const sig = createHmac("sha256", jwtSecret()).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}
function verifyDashboardJwt(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  let secret;
  try {
    secret = jwtSecret();
  } catch {
    return null;
  }
  const expectedSig = createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  const sigBuf = Buffer.from(sig, "base64url");
  const expBuf = Buffer.from(expectedSig, "base64url");
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString());
  } catch {
    return null;
  }
  if (parsed.exp < Math.floor(Date.now() / 1e3)) return null;
  return parsed;
}
function isGithubOauthConfigured() {
  return !!(process.env["GITHUB_CLIENT_ID"] && process.env["GITHUB_CLIENT_SECRET"]);
}
function getGithubAuthUrl(state, redirectUri) {
  const clientId = process.env["GITHUB_CLIENT_ID"];
  if (!clientId) throw new Error("GITHUB_CLIENT_ID env var not set");
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "read:user",
    state
  });
  return `https://github.com/login/oauth/authorize?${params}`;
}
async function exchangeCodeForUser(code) {
  const clientId = process.env["GITHUB_CLIENT_ID"];
  const clientSecret = process.env["GITHUB_CLIENT_SECRET"];
  if (!clientId || !clientSecret) throw new Error("GitHub OAuth not configured");
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code })
  });
  if (!tokenRes.ok) throw new Error(`GitHub token exchange failed: ${tokenRes.status}`);
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    throw new Error(`GitHub OAuth error: ${tokenData.error ?? "no access_token"}`);
  }
  const userRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      "User-Agent": "mcp-llm-bridge",
      Accept: "application/vnd.github+json"
    }
  });
  if (!userRes.ok) throw new Error(`GitHub user fetch failed: ${userRes.status}`);
  return userRes.json();
}
function isUserAllowed(login) {
  const allowed = process.env["GITHUB_ALLOWED_USERS"];
  if (!allowed) return true;
  return allowed.split(",").map((u) => u.trim()).includes(login);
}

export {
  createDashboardJwt,
  verifyDashboardJwt,
  isGithubOauthConfigured,
  getGithubAuthUrl,
  exchangeCodeForUser,
  isUserAllowed
};
