import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';

const COOKIE_NAME = 'gh_upload_session';
const SESSION_MAX_AGE = 8 * 60 * 60; // 8 hours in seconds

function signSession(userId: string, secret: string): string {
  const payload = `${userId}:${Date.now()}`;
  const sig = crypto.createHmac('sha256', secret)
    .update(payload).digest('hex');
  return Buffer.from(`${payload}.${sig}`).toString('base64');
}

function verifySession(token: string, secret: string): string | null {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const lastDot = decoded.lastIndexOf('.');
    const payload = decoded.slice(0, lastDot);
    const sig = decoded.slice(lastDot + 1);
    const expected = crypto.createHmac('sha256', secret)
      .update(payload).digest('hex');
    if (sig !== expected) return null;
    const [userId, ts] = payload.split(':');
    // Check expiry
    if (Date.now() - parseInt(ts) > SESSION_MAX_AGE * 1000) return null;
    return userId;
  } catch {
    return null;
  }
}

export { verifySession, COOKIE_NAME };

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { code, state } = req.query;
  const cookieState = req.cookies?.gh_oauth_state;

  if (!code || !state || !cookieState) {
    return res.status(400).send('Missing OAuth parameters');
  }

  // Validate state (CSRF check)
  const [stateValue, returnToB64] = (state as string).split(':');
  if (stateValue !== cookieState) {
    return res.status(400).send('Invalid OAuth state');
  }

  const returnTo = returnToB64
    ? Buffer.from(returnToB64, 'base64').toString('utf8')
    : '/';

  // Exchange code for token
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });

  const tokenData = await tokenRes.json() as { access_token?: string };
  if (!tokenData.access_token) {
    return res.status(400).send('Failed to exchange code for token');
  }

  // Fetch GitHub user
  const userRes = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });

  const userData = await userRes.json() as { id?: number; login?: string };
  const allowedId = process.env.GITHUB_ALLOWED_USER_ID;

  // Check if this is the allowed user
  if (!userData.id || String(userData.id) !== allowedId) {
    // Clear state cookie
    res.setHeader('Set-Cookie',
      'gh_oauth_state=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/'
    );
    return res.status(403).send(`
      <html><body style="font-family:sans-serif;padding:40px;background:#1a1a1a;color:#fff">
        <h2>Access Denied</h2>
        <p>Your GitHub account is not authorized to access these files.</p>
      </body></html>
    `);
  }

  // Sign a session token
  const secret = process.env.GITHUB_COOKIE_SECRET!;
  const sessionToken = signSession(String(userData.id), secret);

  // Set session cookie + clear state cookie
  res.setHeader('Set-Cookie', [
    `${COOKIE_NAME}=${sessionToken}; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}; Path=/`,
    'gh_oauth_state=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/',
  ]);

  // Redirect back to original file
  res.redirect(returnTo);
}
