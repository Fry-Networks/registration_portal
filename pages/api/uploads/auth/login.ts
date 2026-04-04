import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) {
    return res.status(500).json({ error: 'GitHub OAuth not configured' });
  }

  // Generate state for CSRF protection
  const state = crypto.randomBytes(16).toString('hex');

  // Store state in a short-lived cookie (5 minutes)
  res.setHeader('Set-Cookie',
    `gh_oauth_state=${state}; HttpOnly; Secure; SameSite=Lax; Max-Age=300; Path=/`
  );

  // Get the originally requested file URL to redirect back after auth
  const returnTo = req.query.returnTo as string || '/';

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: 'https://dashboard.frynetworks.com/api/uploads/auth/callback',
    scope: 'read:user',
    state: `${state}:${Buffer.from(returnTo).toString('base64')}`,
  });

  res.redirect(`https://github.com/login/oauth/authorize?${params}`);
}
