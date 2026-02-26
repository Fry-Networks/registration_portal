/**
 * Simple HTTP Test Runner using Node.js http module
 * 
 * This avoids fetch API issues in Node.js and uses native http module
 * 
 * To run: node scripts/test-reward-security-node.mjs
 */

import * as crypto from 'crypto';
import * as http from 'http';

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';
const SIGNATURE_SECRET = process.env.REQUEST_SIGNATURE_SECRET || 'REDACTED_ROTATE_ME';
const TEST_USER_AGENT = 'test-client/1.0';
const CLIENT_TOKEN_SECRET = 'fry-rewards-client-';

const results = [];

/**
 * Generate a client token (browser-side)
 */
function generateClientToken(userAgent) {
  const message = CLIENT_TOKEN_SECRET + userAgent;
  return crypto.createHash('sha256').update(message).digest('hex');
}

/**
 * Generate a request signature (browser-side simulation)
 */
function generateRequestSignature(method, path, body, timestamp) {
  const message = `${method}|${path}|${JSON.stringify(body)}|${timestamp}`;
  return crypto
    .createHmac('sha256', SIGNATURE_SECRET)
    .update(message)
    .digest('hex');
}

/**
 * Make an HTTP request using Node.js http module
 */
function makeRequest(method, path, body, headers) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || 3000,
      path: url.pathname,
      method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': TEST_USER_AGENT,
        ...headers,
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          resolve({
            status: res.statusCode || 500,
            statusText: res.statusMessage || 'Unknown',
            data: data ? JSON.parse(data) : null,
          });
        } catch (err) {
          resolve({
            status: res.statusCode || 500,
            statusText: res.statusMessage || 'Unknown',
            data: data,
          });
        }
      });
    });

    req.on('error', (err) => {
      console.error('  [HTTP ERROR]', err.message);
      resolve({
        status: 0,
        statusText: 'Connection Error',
        data: null,
        error: err.message,
      });
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

/**
 * Test 1: Valid request with both token and signature
 */
async function testValidRequest() {
  console.log('\n[Test 1] Valid request with both token and signature');

  const path = '/api/rewards/claim';
  const timestamp = Math.floor(Date.now() / 1000);
  const body = {
    miner_key: 'test-miner-key',
    address: 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX7Q',
  };

  const clientToken = generateClientToken(TEST_USER_AGENT);
  const signature = generateRequestSignature('POST', path, body, timestamp);

  console.log(`  User Agent: ${TEST_USER_AGENT}`);
  console.log(`  Client Token: ${clientToken.substring(0, 16)}...`);
  console.log(`  Timestamp: ${timestamp}`);
  console.log(`  Signature: ${signature.substring(0, 16)}...`);

  try {
    const response = await makeRequest('POST', path, body, {
      'x-client-token': clientToken,
      'x-request-signature': signature,
      'x-request-timestamp': timestamp.toString(),
    });

    // 200 = success (has session), 401 = unauthorized (no session), both are OK for this test
    const passed =
      response.status === 200 || response.status === 401 || response.data?.code === 'UNAUTHORIZED';

    const result = {
      name: 'Valid request (token + signature)',
      endpoint: path,
      method: 'POST',
      expectedStatus: 200,
      actualStatus: response.status,
      expectedCode: 'success|UNAUTHORIZED',
      actualCode: response.data?.code,
      passed,
      error: passed ? undefined : `Unexpected status ${response.status}`,
    };

    results.push(result);
    console.log(`  Status: ${response.status}`);
    console.log(`  Code: ${response.data?.code}`);
    if (passed) {
      console.log(`  ✓ PASSED (no 403 error)`);
    } else {
      console.log(`  ✗ FAILED - ${result.error}`);
    }
  } catch (err) {
    const result = {
      name: 'Valid request (token + signature)',
      endpoint: path,
      method: 'POST',
      expectedStatus: 200,
      actualStatus: 0,
      passed: false,
      error: err.message,
    };
    results.push(result);
    console.log(`  ✗ Error: ${err.message}`);
  }
}

/**
 * Test 2: Missing client token
 */
async function testMissingClientToken() {
  console.log('\n[Test 2] Missing client token');

  const path = '/api/rewards/claim';
  const timestamp = Math.floor(Date.now() / 1000);
  const body = {
    miner_key: 'test-miner-key',
    address: 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX7Q',
  };

  const signature = generateRequestSignature('POST', path, body, timestamp);

  try {
    const response = await makeRequest('POST', path, body, {
      'x-request-signature': signature,
      'x-request-timestamp': timestamp.toString(),
    });

    const result = {
      name: 'Missing client token',
      endpoint: path,
      method: 'POST',
      expectedStatus: 403,
      actualStatus: response.status,
      expectedCode: 'MISSING_CLIENT_TOKEN',
      actualCode: response.data?.code,
      passed: response.status === 403 && response.data?.code === 'MISSING_CLIENT_TOKEN',
    };

    results.push(result);
    console.log(`  Status: ${response.status}`);
    console.log(`  Code: ${response.data?.code}`);
    console.log(`  Message: ${response.data?.message}`);
    if (result.passed) {
      console.log(`  ✓ PASSED`);
    } else {
      console.log(`  ✗ FAILED - Expected 403 MISSING_CLIENT_TOKEN`);
    }
  } catch (err) {
    const result = {
      name: 'Missing client token',
      endpoint: path,
      method: 'POST',
      expectedStatus: 403,
      actualStatus: 0,
      passed: false,
      error: err.message,
    };
    results.push(result);
    console.log(`  ✗ Error: ${err.message}`);
  }
}

/**
 * Test 3: Invalid client token
 */
async function testInvalidClientToken() {
  console.log('\n[Test 3] Invalid client token');

  const path = '/api/rewards/claim';
  const timestamp = Math.floor(Date.now() / 1000);
  const body = {
    miner_key: 'test-miner-key',
    address: 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX7Q',
  };

  const invalidToken = 'invalid_token_' + Math.random().toString(36).substring(7);
  const signature = generateRequestSignature('POST', path, body, timestamp);

  try {
    const response = await makeRequest('POST', path, body, {
      'x-client-token': invalidToken,
      'x-request-signature': signature,
      'x-request-timestamp': timestamp.toString(),
    });

    const result = {
      name: 'Invalid client token',
      endpoint: path,
      method: 'POST',
      expectedStatus: 403,
      actualStatus: response.status,
      expectedCode: 'INVALID_CLIENT_TOKEN',
      actualCode: response.data?.code,
      passed: response.status === 403 && response.data?.code === 'INVALID_CLIENT_TOKEN',
    };

    results.push(result);
    console.log(`  Status: ${response.status}`);
    console.log(`  Code: ${response.data?.code}`);
    console.log(`  Message: ${response.data?.message}`);
    if (result.passed) {
      console.log(`  ✓ PASSED`);
    } else {
      console.log(`  ✗ FAILED - Expected 403 INVALID_CLIENT_TOKEN`);
    }
  } catch (err) {
    const result = {
      name: 'Invalid client token',
      endpoint: path,
      method: 'POST',
      expectedStatus: 403,
      actualStatus: 0,
      passed: false,
      error: err.message,
    };
    results.push(result);
    console.log(`  ✗ Error: ${err.message}`);
  }
}

/**
 * Test 4: Missing request signature
 */
async function testMissingSignature() {
  console.log('\n[Test 4] Missing request signature');

  const path = '/api/rewards/claim';
  const body = {
    miner_key: 'test-miner-key',
    address: 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX7Q',
  };

  const clientToken = generateClientToken(TEST_USER_AGENT);

  try {
    const response = await makeRequest('POST', path, body, {
      'x-client-token': clientToken,
      // Missing: x-request-signature and x-request-timestamp
    });

    const result = {
      name: 'Missing request signature',
      endpoint: path,
      method: 'POST',
      expectedStatus: 403,
      actualStatus: response.status,
      expectedCode: 'MISSING_SIGNATURE',
      actualCode: response.data?.code,
      passed: response.status === 403 && response.data?.code === 'MISSING_SIGNATURE',
    };

    results.push(result);
    console.log(`  Status: ${response.status}`);
    console.log(`  Code: ${response.data?.code}`);
    console.log(`  Message: ${response.data?.message}`);
    if (result.passed) {
      console.log(`  ✓ PASSED`);
    } else {
      console.log(`  ✗ FAILED - Expected 403 MISSING_SIGNATURE`);
    }
  } catch (err) {
    const result = {
      name: 'Missing request signature',
      endpoint: path,
      method: 'POST',
      expectedStatus: 403,
      actualStatus: 0,
      passed: false,
      error: err.message,
    };
    results.push(result);
    console.log(`  ✗ Error: ${err.message}`);
  }
}

/**
 * Test 5: Invalid request signature
 */
async function testInvalidSignature() {
  console.log('\n[Test 5] Invalid request signature');

  const path = '/api/rewards/claim';
  const timestamp = Math.floor(Date.now() / 1000);
  const body = {
    miner_key: 'test-miner-key',
    address: 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX7Q',
  };

  const clientToken = generateClientToken(TEST_USER_AGENT);
  const invalidSignature = 'invalid_sig_' + Math.random().toString(36).substring(7);

  try {
    const response = await makeRequest('POST', path, body, {
      'x-client-token': clientToken,
      'x-request-signature': invalidSignature,
      'x-request-timestamp': timestamp.toString(),
    });

    const result = {
      name: 'Invalid request signature',
      endpoint: path,
      method: 'POST',
      expectedStatus: 403,
      actualStatus: response.status,
      expectedCode: 'INVALID_SIGNATURE',
      actualCode: response.data?.code,
      passed: response.status === 403 && response.data?.code === 'INVALID_SIGNATURE',
    };

    results.push(result);
    console.log(`  Status: ${response.status}`);
    console.log(`  Code: ${response.data?.code}`);
    console.log(`  Message: ${response.data?.message}`);
    if (result.passed) {
      console.log(`  ✓ PASSED`);
    } else {
      console.log(`  ✗ FAILED - Expected 403 INVALID_SIGNATURE`);
    }
  } catch (err) {
    const result = {
      name: 'Invalid request signature',
      endpoint: path,
      method: 'POST',
      expectedStatus: 403,
      actualStatus: 0,
      passed: false,
      error: err.message,
    };
    results.push(result);
    console.log(`  ✗ Error: ${err.message}`);
  }
}

/**
 * Test 6: Tampered request body
 */
async function testTamperedBody() {
  console.log('\n[Test 6] Tampered request body');

  const path = '/api/rewards/claim';
  const timestamp = Math.floor(Date.now() / 1000);
  const originalBody = {
    miner_key: 'test-miner-key',
    address: 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX7Q',
  };

  // Generate signature for original body
  const signature = generateRequestSignature('POST', path, originalBody, timestamp);
  const clientToken = generateClientToken(TEST_USER_AGENT);

  // Send tampered body with original signature
  const tamperedBody = {
    miner_key: 'HACKED-miner-key',
    address: 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX7Q',
  };

  try {
    const response = await makeRequest('POST', path, tamperedBody, {
      'x-client-token': clientToken,
      'x-request-signature': signature,
      'x-request-timestamp': timestamp.toString(),
    });

    const result = {
      name: 'Tampered request body',
      endpoint: path,
      method: 'POST',
      expectedStatus: 403,
      actualStatus: response.status,
      expectedCode: 'INVALID_SIGNATURE',
      actualCode: response.data?.code,
      passed: response.status === 403 && response.data?.code === 'INVALID_SIGNATURE',
    };

    results.push(result);
    console.log(`  Status: ${response.status}`);
    console.log(`  Code: ${response.data?.code}`);
    console.log(`  Message: ${response.data?.message}`);
    if (result.passed) {
      console.log(`  ✓ PASSED`);
    } else {
      console.log(`  ✗ FAILED - Expected 403 INVALID_SIGNATURE`);
    }
  } catch (err) {
    const result = {
      name: 'Tampered request body',
      endpoint: path,
      method: 'POST',
      expectedStatus: 403,
      actualStatus: 0,
      passed: false,
      error: err.message,
    };
    results.push(result);
    console.log(`  ✗ Error: ${err.message}`);
  }
}

/**
 * Test 7: Expired timestamp (too old)
 */
async function testExpiredTimestamp() {
  console.log('\n[Test 7] Expired timestamp (> 5 minutes old)');

  const path = '/api/rewards/claim';
  const expiredTimestamp = Math.floor(Date.now() / 1000) - 400; // 400 seconds old (exceeds 5-minute max)
  const body = {
    miner_key: 'test-miner-key',
    address: 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX7Q',
  };

  const clientToken = generateClientToken(TEST_USER_AGENT);
  const signature = generateRequestSignature('POST', path, body, expiredTimestamp);

  try {
    const response = await makeRequest('POST', path, body, {
      'x-client-token': clientToken,
      'x-request-signature': signature,
      'x-request-timestamp': expiredTimestamp.toString(),
    });

    const result = {
      name: 'Expired timestamp (> 5 min)',
      endpoint: path,
      method: 'POST',
      expectedStatus: 403,
      actualStatus: response.status,
      expectedCode: 'INVALID_SIGNATURE',
      actualCode: response.data?.code,
      passed: response.status === 403 && response.data?.code === 'INVALID_SIGNATURE',
    };

    results.push(result);
    console.log(`  Status: ${response.status}`);
    console.log(`  Code: ${response.data?.code}`);
    console.log(`  Message: ${response.data?.message}`);
    if (result.passed) {
      console.log(`  ✓ PASSED`);
    } else {
      console.log(`  ✗ FAILED - Expected 403 INVALID_SIGNATURE`);
    }
  } catch (err) {
    const result = {
      name: 'Expired timestamp (> 5 min)',
      endpoint: path,
      method: 'POST',
      expectedStatus: 403,
      actualStatus: 0,
      passed: false,
      error: err.message,
    };
    results.push(result);
    console.log(`  ✗ Error: ${err.message}`);
  }
}

/**
 * Main test runner
 */
async function runAllTests() {
  console.log('========================================');
  console.log('Reward API Security Test Suite');
  console.log('========================================');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Test User Agent: ${TEST_USER_AGENT}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log('');

  // Run tests sequentially
  await testValidRequest();
  await testMissingClientToken();
  await testInvalidClientToken();
  await testMissingSignature();
  await testInvalidSignature();
  await testTamperedBody();
  await testExpiredTimestamp();

  // Print summary
  console.log('\n========================================');
  console.log('Test Summary');
  console.log('========================================');

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.table(
    results.map((r) => ({
      Test: r.name,
      Status: `${r.actualStatus}`,
      Expected: r.expectedCode || r.expectedStatus,
      Actual: r.actualCode || r.actualStatus,
      Result: r.passed ? '✓ PASS' : '✗ FAIL',
    }))
  );

  console.log('');
  console.log(`Total: ${results.length} tests`);
  console.log(`Passed: ${passed} ✓`);
  console.log(`Failed: ${failed} ✗`);
  console.log(`Pass Rate: ${Math.round((passed / results.length) * 100)}%`);
  console.log('');

  if (failed === 0) {
    console.log('🎉 All tests passed!');
    process.exit(0);
  } else {
    console.log(`⚠️  ${failed} test(s) failed`);
    process.exit(1);
  }
}

runAllTests().catch((err) => {
  console.error('Test suite error:', err);
  process.exit(1);
});
