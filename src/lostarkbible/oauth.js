import { randomBytes, createHash } from 'node:crypto';
import { config } from '../config.js';

// Confirmed live against lostark.bible's own
// /.well-known/oauth-authorization-server — these are the real endpoints,
// distinct from the /api/oauth/* resource endpoints in client.js (those take
// an already-issued Bearer token; these are the flow that issues one).
const AUTHORIZE_ENDPOINT = `${config.laBibleBaseUrl}/oauth/authorize`;
const TOKEN_ENDPOINT = `${config.laBibleBaseUrl}/oauth/token`;

const SCOPES = 'identify rosters logs';

/** PKCE code_verifier — 32 random bytes, base64url gives 43 chars, within
 * RFC 7636's required 43-128 range. */
export function generateCodeVerifier() {
  return randomBytes(32).toString('base64url');
}

function codeChallengeFromVerifier(verifier) {
  return createHash('sha256').update(verifier).digest('base64url');
}

/** The link a user clicks to start the flow. `state` is an opaque random
 * value the caller generates and holds onto (see linkAccount.js) to
 * correlate the eventual /oauth/callback hit back to who started it — not
 * used for PKCE itself, just CSRF protection + request correlation. */
export function buildAuthorizeUrl({ state, codeVerifier }) {
  const params = new URLSearchParams({
    client_id: config.laBibleClientId,
    redirect_uri: config.oauthRedirectUri,
    response_type: 'code',
    scope: SCOPES,
    state,
    code_challenge: codeChallengeFromVerifier(codeVerifier),
    code_challenge_method: 'S256',
  });
  return `${AUTHORIZE_ENDPOINT}?${params.toString()}`;
}

/** Exchanges an authorization code for a token. Public client (no
 * client_secret) — codeVerifier is what proves this exchange came from the
 * same place that started the authorize request, per PKCE. */
export async function exchangeCodeForToken({ code, codeVerifier }) {
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.oauthRedirectUri,
    client_id: config.laBibleClientId,
    code_verifier: codeVerifier,
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`lostark.bible token exchange failed: ${response.status} ${body}`);
  }

  return response.json(); // { access_token, token_type, expires_in, scope }
}

/** GET /api/oauth/user — requires the `identify` scope. Returns lostark.bible
 * user id + Discord id directly, per the app-page plan's original design:
 * no separate "Login with Discord" needed since this IS the Discord
 * identity, straight from lostark.bible's side. */
export async function getOAuthUser(accessToken) {
  const response = await fetch(`${config.laBibleBaseUrl}/api/oauth/user`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`lostark.bible /api/oauth/user failed: ${response.status} ${body}`);
  }
  return response.json();
}
