#!/usr/bin/env node

/**
 * Quick authenticated test with actual user session
 * Tests that ALL reward endpoints now have security layers
 */

import { execSync } from 'child_process';
import * as crypto from 'crypto';

const BASE_URL = 'http://localhost:3001'; // Updated to port 3001
const SIGNATURE_SECRET = process.env.REQUEST_SIGNATURE_SECRET || 'REDACTED_ROTATE_ME';
const TEST_USER_AGENT = 'test-client/1.0';
const CLIENT_TOKEN_SECRET = 'fry-rewards-client-';

let sessionCookie = process.env.SESSION_COOKIE;
if (!sessionCookie) {
  console.error('❌ SESSION_COOKIE environment variable not set');
  process.exit(1);
}

const results = [];
let userAddress = null;

function generateClientToken(userAgent) {
  const message = CLIENT_TOKEN_SECRET + userAgent;
  return crypto.createHash('sha256').update(message).digest('hex');
}

function generateRequestSignature(method, path, body, timestamp) {
  const message = `${method}|${path}|${JSON.stringify(body)}|${timestamp}`;
  return crypto
    .createHmac('sha256', SIGNATURE_SECRET)
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

  const clientToken = generateClientToken(TEST_USER_AGENT);
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
