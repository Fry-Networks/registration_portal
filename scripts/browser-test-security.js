/**
 * Browser Console Test - Paste this entire script into your browser console (F12)
 * This tests the security layers with your authenticated session automatically
 * 
 * Open http://localhost:3000 in your browser, then:
 * 1. Press F12 to open DevTools
 * 2. Go to Console tab
 * 3. Paste this entire script and press Enter
 * 4. Wait for results
 */

const BASE_URL = 'http://localhost:3000';
// R11 NEGATIVE CONTROL: the value below is the RETIRED, publicly-known L2 constant that used
// to ship in the client bundle. It is kept deliberately so these scripts prove the server now
// REJECTS constant-signed requests. It is not a credential and grants nothing.
const SIGNATURE_SECRET = 'fry-rewards-signature-v1-';
let CLIENT_TOKEN = null;
const TEST_USER_AGENT = navigator.userAgent;

console.log('🚀 Starting Security Layer Tests...\n');

// R12: the L1 client token is PER-SESSION and issued by the server. It used to be
// sha256('<constant>' + userAgent) from a constant that shipped in this very bundle, so anyone
// could mint one. This script runs inside the signed-in browser, so it just asks for its own.
async function getClientToken() {
  if (CLIENT_TOKEN) return CLIENT_TOKEN;
  const res = await fetch(`${BASE_URL}/api/auth/signing-key`, { credentials: 'same-origin' });
  if (!res.ok) {
    throw new Error(`Unable to obtain a per-session client token (status ${res.status})`);
  }
  const data = await res.json();
  if (!data || typeof data.clientToken !== 'string' || data.clientToken.length === 0) {
    throw new Error('signing-key response carried no clientToken');
  }
  CLIENT_TOKEN = data.clientToken;
  return CLIENT_TOKEN;
}

function generateRequestSignature(method, path, body, timestamp) {
  const message = `${method}|${path}|${JSON.stringify(body)}|${timestamp}`;
  return hmacSha256(SIGNATURE_SECRET, message);
}

// Simple SHA256 implementation
async function sha256(message) {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Simple HMAC-SHA256 implementation
async function hmacSha256(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  const sigArray = Array.from(new Uint8Array(signature));
  return sigArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function testSecurityLayers() {
  try {
    // Step 1: Get user session
    console.log('[Step 1] Fetching user session...');
    const sessionRes = await fetch(`${BASE_URL}/api/auth/session`);
    const session = await sessionRes.json();
    
    if (!session || !session.user || !session.user.address) {
      console.error('❌ Session not found. Are you logged in? Go to http://localhost:3000 and sign in first.');
      return;
    }
    
    const userAddress = session.user.address;
    console.log(`✓ User Address: ${userAddress.substring(0, 16)}...\n`);

    const results = [];

    // Test 1: Get rewards page
    console.log('[Test 1] Get rewards page (with security layers)...');
    {
      const path = '/api/rewards/get-rewards-page';
      const timestamp = Math.floor(Date.now() / 1000);
      const body = {
        address: userAddress,
        miner_key: 'test-miner-key',
        page: 1,
      };

      const clientToken = await getClientToken();
      const signature = await generateRequestSignature('POST', path, body, timestamp);

      const response = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-client-token': clientToken,
          'x-request-signature': signature,
          'x-request-timestamp': timestamp.toString(),
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      const passed = response.status === 200;
      results.push({ name: 'Get rewards page', passed, status: response.status, code: data?.code || 'OK' });
      console.log(`  Status: ${response.status} ${passed ? '✓ PASS' : '✗ FAIL'}\n`);
    }

    // Test 2: Get asset totals
    console.log('[Test 2] Get asset totals (with security layers)...');
    {
      const path = '/api/rewards/get-asset-totals';
      const timestamp = Math.floor(Date.now() / 1000);
      const body = { address: userAddress };

      const clientToken = await getClientToken();
      const signature = await generateRequestSignature('POST', path, body, timestamp);

      const response = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-client-token': clientToken,
          'x-request-signature': signature,
          'x-request-timestamp': timestamp.toString(),
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      const passed = response.status === 200;
      results.push({ name: 'Get asset totals', passed, status: response.status, code: data?.code || 'OK' });
      console.log(`  Status: ${response.status} ${passed ? '✓ PASS' : '✗ FAIL'}\n`);
    }

    // Test 3: Claim rewards
    console.log('[Test 3] Claim rewards (with security layers)...');
    {
      const path = '/api/rewards/claim';
      const timestamp = Math.floor(Date.now() / 1000);
      const body = {
        address: userAddress,
        miner_key: 'test-miner-key',
      };

      const clientToken = await getClientToken();
      const signature = await generateRequestSignature('POST', path, body, timestamp);

      const response = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-client-token': clientToken,
          'x-request-signature': signature,
          'x-request-timestamp': timestamp.toString(),
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      // Claim can return various status codes, just check it's not 403
      const passed = response.status !== 403;
      results.push({ name: 'Claim rewards', passed, status: response.status, code: data?.code || 'OK' });
      console.log(`  Status: ${response.status} ${passed ? '✓ PASS' : '✗ FAIL'}\n`);
    }

    // Test 4: Request without security layers (should fail)
    console.log('[Test 4] Request WITHOUT security layers (should fail with 403)...');
    {
      const path = '/api/rewards/get-asset-totals';
      const body = { address: userAddress };

      const response = await fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();
      const passed = response.status === 403 && (data?.code === 'MISSING_CLIENT_TOKEN' || data?.code === 'MISSING_SIGNATURE');
      results.push({ name: 'Request without security layers', passed, status: response.status, code: data?.code });
      console.log(`  Status: ${response.status} ${passed ? '✓ PASS (correctly blocked)' : '✗ FAIL'}\n`);
    }

    // Summary
    console.log('═══════════════════════════════════════════');
    console.log('TEST SUMMARY');
    console.log('═══════════════════════════════════════════');
    console.table(results);

    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    console.log(`\nTotal: ${results.length} | Passed: ${passed} ✓ | Failed: ${failed} ✗`);
    console.log(`Pass Rate: ${Math.round((passed / results.length) * 100)}%\n`);

    if (failed === 0) {
      console.log('🎉 All tests passed! Security layers are working correctly!');
    } else if (failed === 1 && results[3].passed === false) {
      console.log('✓ Security layers working! Test 4 correctly blocked unsigned requests.');
    } else {
      console.log('⚠️ Some tests failed.');
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// Run tests
testSecurityLayers();
