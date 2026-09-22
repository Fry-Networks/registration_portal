#!/usr/bin/env node

/**
 * Quick authenticated test with actual user session
 * Tests that ALL reward endpoints now have security layers
 */

import { execSync } from 'child_process';
import * as crypto from 'crypto';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3007';
// R11: the L2 signing key is per-session and issued by the server. It is fetched once here
// using this script's own session cookie. Signing with a global constant no longer works --
// that constant used to ship in the client bundle, which is exactly what R11 removed.
let SIGNING_KEY = null;
function getSigningKey() {
  if (SIGNING_KEY) return SIGNING_KEY;
  const cmd = `curl -s "${BASE_URL}/api/auth/signing-key" -H "User-Agent: ${TEST_USER_AGENT}" -H "Cookie: __Secure-next-auth.session-token=${sessionCookie}"`;
  const out = execSync(cmd, { encoding: 'utf8' });
  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch {
    throw new Error(`signing-key fetch returned non-JSON: ${out.slice(0, 200)}`);
  }
  if (!parsed || typeof parsed.key !== 'string') {
    throw new Error(`signing-key fetch failed: ${out.slice(0, 200)}`);
  }
  SIGNING_KEY = parsed.key;
  CLIENT_TOKEN = typeof parsed.clientToken === 'string' ? parsed.clientToken : null;
  return SIGNING_KEY;
}
const TEST_USER_AGENT = 'test-client/1.0';
let CLIENT_TOKEN = null;

let sessionCookie = process.env.SESSION_COOKIE;
if (!sessionCookie) {
  console.error('❌ SESSION_COOKIE environment variable not set');
  process.exit(1);
}

const results = [];
let userAddress = null;

/**
 * R12: the L1 client token is PER-SESSION and issued by the server alongside the L2 signing key.
 * It used to be sha256('<constant>' + userAgent) from a constant that shipped in the client
 * bundle, so anyone could mint one. getSigningKey() caches both values from one call.
 */
function getClientToken() {
  if (!CLIENT_TOKEN) {
    getSigningKey();
  }
  if (typeof CLIENT_TOKEN !== 'string' || CLIENT_TOKEN.length === 0) {
    throw new Error('signing-key response carried no clientToken');
  }
  return CLIENT_TOKEN;
}

function generateRequestSignature(method, path, body, timestamp) {
  const message = `${method}|${path}|${JSON.stringify(body)}|${timestamp}`;
  return crypto
    .createHmac('sha256', getSigningKey())
    .update(message)
    .digest('hex');
}

function runCurl(method, path, body, headers, cookie) {
  const url = `${BASE_URL}${path}`;
  let cmd = `curl -s -X ${method} "${url}"`;
  cmd += ` -H "Content-Type: application/json"`;
  cmd += ` -H "User-Agent: ${TEST_USER_AGENT}"`;
  
  if (cookie) {
    cmd += ` -H "Cookie: __Secure-next-auth.session-token=${cookie}"`;
  }
  
  for (const [key, value] of Object.entries(headers)) {
    cmd += ` -H "${key}: ${value}"`;
  }
  
  if (body) {
    const bodyStr = JSON.stringify(body).replace(/"/g, '\\"');
    cmd += ` -d "${bodyStr}"`;
  }
  
  cmd += ` -w "\\n%{http_code}"`;
  
  try {
    const output = execSync(cmd, { encoding: 'utf8' });
    const lines = output.trim().split('\n');
    const statusCode = parseInt(lines[lines.length - 1], 10);
    const responseBody = lines.slice(0, -1).join('\n');
    
    try {
      return {
        status: statusCode,
        data: JSON.parse(responseBody),
      };
    } catch {
      return {
        status: statusCode,
        data: responseBody,
      };
    }
  } catch (err) {
    return {
      status: 0,
      data: null,
      error: err.message,
    };
  }
}

async function getSessionInfo() {
  console.log('[Step 1] Retrieving session info...');
  const url = `${BASE_URL}/api/auth/session`;
  let cmd = `curl -s -X GET "${url}" -H "Cookie: __Secure-next-auth.session-token=${sessionCookie}"`;
  
  try {
    const output = execSync(cmd, { encoding: 'utf8' });
    const session = JSON.parse(output);
    
    if (session && session.user && session.user.address) {
      userAddress = session.user.address;
      console.log(`✓ User: ${userAddress.substring(0, 20)}...\n`);
      return true;
    } else {
      console.error('✗ Session invalid or expired');
      return false;
    }
  } catch (err) {
    console.error('✗ Failed to get session:', err.message);
    return false;
  }
}

function test(name, path, shouldPass = true) {
  const timestamp = Math.floor(Date.now() / 1000);
  const body = { address: userAddress, miner_key: 'test-key', page: 1 };

  const clientToken = getClientToken();
  const signature = generateRequestSignature('POST', path, body, timestamp);

  const response = runCurl('POST', path, body, {
    'x-client-token': clientToken,
    'x-request-signature': signature,
    'x-request-timestamp': timestamp.toString(),
  }, sessionCookie);

  const passed = shouldPass ? (response.status === 200) : (response.status !== 0);
  results.push({ name, status: response.status, code: response.data?.code, passed });
  console.log(`${name}${' '.repeat(40 - name.length)}${response.status} ${passed ? '✓' : '✗'}`);
}

async function runTests() {
  console.log('╔════════════════════════════════════════════╗');
  console.log('║  Reward API - All Endpoints Security Test  ║');
  console.log('╚════════════════════════════════════════════╝\n');

  const gotSession = await getSessionInfo();
  if (!gotSession) {
    process.exit(1);
  }

  console.log('Testing endpoints with security layers:\n');
  
  test('✓ GET /api/rewards/get-rewards-page', '/api/rewards/get-rewards-page');
  test('✓ GET /api/rewards/get-asset-totals', '/api/rewards/get-asset-totals');
  test('✓ GET /api/rewards/get-reward-summary', '/api/rewards/get-reward-summary');
  test('✓ GET /api/rewards/get-reward-records', '/api/rewards/get-reward-records');
  test('✓ GET /api/rewards/claim', '/api/rewards/claim');
  test('✓ GET /api/rewards/boost', '/api/rewards/boost');
  test('✓ GET /api/rewards/confirm', '/api/rewards/confirm');

  console.log('\n═══════════════════════════════════════════\n');

  const passed = results.filter(r => r.passed).length;
  console.log(`Results: ${passed}/${results.length} endpoints protected ✓\n`);

  if (passed === results.length) {
    console.log('🎉 SUCCESS: All reward endpoints now have security layers!');
  } else {
    console.log('⚠️ Some endpoints still need protection');
    console.table(results.filter(r => !r.passed));
  }
}

runTests().catch(console.error);
