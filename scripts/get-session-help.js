#!/usr/bin/env node

/**
 * Helper script to extract session from browser
 * Prints instructions on how to get your session cookie
 */

const chalk = require('chalk');

console.log(`
╔════════════════════════════════════════════════════════════════╗
║                    Session Extraction Helper                   ║
╚════════════════════════════════════════════════════════════════╝

To test with your authenticated session, follow these steps:

1️⃣  Make sure http://localhost:3000 is open in your browser

2️⃣  Open Developer Tools (Press F12)

3️⃣  Go to: Application → Cookies → http://localhost:3000

4️⃣  Look for the cookie named: "next-auth.session-token"

5️⃣  RIGHT-CLICK on "next-auth.session-token" and select "Copy Value"

6️⃣  Run one of these commands with your cookie:

   Option A - Using --session flag:
   node scripts/test-authenticated-session.mjs --session="your_cookie_here"

   Option B - Using environment variable:
   $env:SESSION_COOKIE="your_cookie_here"; node scripts/test-authenticated-session.mjs

   Option C - (Windows) Create .env file with:
   SESSION_COOKIE=your_cookie_here
   Then run: node scripts/test-authenticated-session.mjs

📋 Example (with dummy cookie):
   node scripts/test-authenticated-session.mjs --session="ABC123..."

⚠️  Session cookies expire after a period of inactivity.
   If you get an error, get a fresh cookie from your browser.

✅ The test will automatically extract your user address from the session
   and validate the security layers with your actual wallet data.

═══════════════════════════════════════════════════════════════════
`);
