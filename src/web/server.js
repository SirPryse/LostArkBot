import { createServer } from 'node:http';
import { config } from '../config.js';
import { exchangeCodeForToken, getOAuthUser } from '../lostarkbible/oauth.js';
import { takePendingLink } from '../oauth/pendingLinks.js';
import { upsertLinkedAccount } from '../db/linkedAccounts.js';
import { encryptToken } from '../crypto/tokenCipher.js';

// Deliberately no framework (express, etc.) — this exists for exactly one
// route. Discord itself has no way to receive a third-party OAuth redirect
// (it only ever makes outbound connections, see client.js/poller.js), so
// *some* real HTTP endpoint is unavoidable — this is that endpoint, folded
// into the bot's own existing process/deployment instead of a separate
// project. Everything past "you're linked" (picking characters, etc.)
// happens back in Discord via /track-character, which already exists.
//
// Lost Ark-inspired: dark navy/parchment backdrop, gold filigree border,
// Cinzel for the heading (fantasy-serif, same family a lot of MMO UIs lean
// on) — closer to the game's own look than generic Discord branding. Google
// Fonts is an external request, which is fine here (this is a normal
// server-rendered page, not sandboxed like an Artifact).
const DISCORD_RETURN_URL = 'https://discord.com/channels/@me';

function page({ status, icon, title, body, showDiscordButton = false }) {
  const accent = status === 'success' ? '#d4af37' : '#a8342a';
  return `<!doctype html>
<html>
<head>
<title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700&family=Cormorant+Garamond:wght@500&display=swap" rel="stylesheet">
<style>
  :root { --accent: ${accent}; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding: 1.5rem;
    background:
      radial-gradient(ellipse at top, #1c2333 0%, #0a0c12 60%),
      linear-gradient(180deg, #0a0c12, #05060a);
    color: #e9e1c8;
    font-family: 'Cormorant Garamond', Georgia, serif;
  }
  .frame {
    position: relative; max-width: 420px; width: 100%; padding: 2px;
    background: linear-gradient(155deg, #d4af37 0%, #8a6d1f 30%, #52441a 50%, #d4af37 70%, #8a6d1f 100%);
    border-radius: 14px;
    box-shadow: 0 0 0 1px rgba(212,175,55,0.25), 0 20px 60px rgba(0,0,0,0.6), 0 0 40px rgba(212,175,55,0.08);
  }
  .card {
    background:
      radial-gradient(ellipse at top, #1a1e2b 0%, #12141c 70%);
    border-radius: 12px; padding: 3rem 2.25rem 2.5rem; text-align: center;
  }
  .icon {
    width: 60px; height: 60px; border-radius: 50%; margin: 0 auto 1.5rem;
    display: flex; align-items: center; justify-content: center;
    border: 2px solid var(--accent); color: var(--accent);
    box-shadow: 0 0 18px color-mix(in srgb, var(--accent) 45%, transparent), inset 0 0 12px color-mix(in srgb, var(--accent) 20%, transparent);
    font-family: Georgia, serif; font-size: 1.75rem;
  }
  h1 {
    font-family: 'Cinzel', Georgia, serif; font-weight: 700; letter-spacing: 0.03em;
    font-size: 1.4rem; margin: 0 0 0.75rem; color: #f3e9c9;
    text-shadow: 0 0 20px color-mix(in srgb, var(--accent) 40%, transparent);
  }
  p { color: #b9ae95; line-height: 1.6; margin: 0; font-size: 1.15rem; }
  code {
    background: rgba(212,175,55,0.1); border: 1px solid rgba(212,175,55,0.25);
    padding: 0.1rem 0.45rem; border-radius: 4px; font-size: 0.85em; font-family: monospace; color: #e9d99a;
  }
  .divider {
    width: 64px; height: 1px; margin: 1.5rem auto;
    background: linear-gradient(90deg, transparent, var(--accent), transparent);
  }
  .btn {
    display: inline-block; margin-top: 0.5rem; padding: 0.7rem 2rem; border-radius: 6px;
    background: linear-gradient(155deg, #e9d18a, #c9a020);
    color: #1a1408; text-decoration: none; font-weight: 700; font-size: 0.95rem;
    font-family: 'Cinzel', Georgia, serif; letter-spacing: 0.05em;
    box-shadow: 0 4px 14px rgba(201,160,32,0.35);
  }
  .btn:hover { background: linear-gradient(155deg, #f3ddA0, #d9b030); }
</style>
</head>
<body>
  <div class="frame">
    <div class="card">
      <div class="icon">${icon}</div>
      <h1>${title}</h1>
      <p>${body}</p>
      ${showDiscordButton ? `<div class="divider"></div><a class="btn" href="${DISCORD_RETURN_URL}">Return to Discord</a>` : ''}
    </div>
  </div>
</body>
</html>`;
}

async function handleCallback(url, res) {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page({
      status: 'error', icon: '✕', title: 'Authorization declined',
      body: `lostark.bible reported: <code>${error}</code>. You can close this tab and try <code>/link-account</code> again.`,
    }));
    return;
  }

  if (!code || !state) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page({
      status: 'error', icon: '✕', title: 'Missing parameters',
      body: 'This link is missing required parameters — did you navigate here directly? Run <code>/link-account</code> in Discord to start over.',
    }));
    return;
  }

  const pending = takePendingLink(state);
  if (!pending) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page({
      status: 'error', icon: '✕', title: 'Link expired or already used',
      body: 'This link is no longer valid — it may have expired (10 min) or already been used. Run <code>/link-account</code> again in Discord.',
    }));
    return;
  }

  try {
    const token = await exchangeCodeForToken({ code, codeVerifier: pending.codeVerifier });
    const oauthUser = await getOAuthUser(token.access_token);

    await upsertLinkedAccount({
      discordUserId: pending.discordUserId,
      lostarkbibleUserId: String(oauthUser.id),
      encryptedAccessToken: encryptToken(token.access_token),
      tokenExpiresAt: new Date(Date.now() + token.expires_in * 1000),
      scopes: token.scope,
    });

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page({
      status: 'success', icon: '✓', title: 'Account linked!',
      body: 'Your lostark.bible account is connected. Go back to Discord and run <code>/track-character</code> to pick which characters to track.',
      showDiscordButton: true,
    }));
  } catch (err) {
    console.error('OAuth callback failed:', err);
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page({
      status: 'error', icon: '✕', title: 'Something went wrong',
      body: 'The token exchange failed on our end — try <code>/link-account</code> again, and let us know if it keeps happening.',
    }));
  }
}

export function startOAuthServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url, `http://localhost:${config.oauthPort}`);

    if (url.pathname === '/oauth/callback' && req.method === 'GET') {
      handleCallback(url, res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  server.listen(config.oauthPort, () => {
    console.log(`OAuth callback server listening on port ${config.oauthPort}`);
  });

  return server;
}
