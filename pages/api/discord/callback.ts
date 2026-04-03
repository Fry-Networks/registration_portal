import type { NextApiRequest, NextApiResponse } from 'next';
import clientPromise from '../../../lib/mongoclient';

// Send OAuth result to opener window via postMessage
function sendOauthResult(res: NextApiResponse, status: string, reason?: string) {
  // Remove headers that might block postMessage
  res.removeHeader('Content-Security-Policy');
  res.removeHeader('Cross-Origin-Opener-Policy');
  
  const message = JSON.stringify({ type: 'discord-oauth-result', status, reason });
  
  const html = `<!DOCTYPE html>
<html>
<head><title>Discord Link</title></head>
<body>
<script>
  try {
    window.opener.postMessage(${message}, 'https://dashboard.frynetworks.com');
  } catch (e) {
    console.error('postMessage failed:', e);
  }
  window.close();
</script>
<p>Linking Discord... You may close this window.</p>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html');
  res.status(200).send(html);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return sendOauthResult(res, 'error', 'invalid_method');
  }

  const { code, state } = req.query;

  if (!code || typeof code !== 'string' || !state || typeof state !== 'string') {
    return sendOauthResult(res, 'error', 'missing_params');
  }

  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const redirectUri = process.env.DISCORD_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    return sendOauthResult(res, 'error', 'not_configured');
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');

    // Look up and delete state
    const stateDoc = await db.collection('discord_oauth_states').findOneAndDelete({ state });
    
    if (!stateDoc) {
      return sendOauthResult(res, 'error', 'invalid_state');
    }

    const walletAddress = stateDoc.walletAddress;

    // Exchange code for token
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri
      })
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      console.error('[discord/callback] Token exchange failed:', error);
      return sendOauthResult(res, 'error', 'token_failed');
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    // Fetch Discord user info
    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    });

    if (!userResponse.ok) {
      console.error('[discord/callback] User fetch failed');
      return sendOauthResult(res, 'error', 'user_fetch_failed');
    }

    const discordUser = await userResponse.json();
    const discordId = discordUser.id;
    const discordUsername = discordUser.global_name || discordUser.username;

    // Check for duplicate linking (same Discord ID, different wallet)
    const existingLink = await db.collection('registration-users').findOne({
      discordId,
      address: { $ne: walletAddress }
    });

    if (existingLink) {
      return sendOauthResult(res, 'error', 'already_linked');
    }

    // Update user document
    await db.collection('registration-users').updateOne(
      { address: walletAddress },
      {
        $set: {
          discordId,
          discordUsername,
          discordLinkedAt: new Date()
        }
      }
    );

    return sendOauthResult(res, 'linked');
  } catch (error) {
    console.error('[discord/callback] Error:', error);
    return sendOauthResult(res, 'error', 'internal_error');
  }
}
