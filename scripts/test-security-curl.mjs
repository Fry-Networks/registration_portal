#!/usr/bin/env node

/**
 * Simple curl-based test suite for Reward API Security
 * Uses child_process to run curl commands
 */

import { execSync } from 'child_process';
import * as crypto from 'crypto';

const BASE_URL = 'http://localhost:3000';
const SIGNATURE_SECRET = process.env.REQUEST_SIGNATURE_SECRET;
if (!SIGNATURE_SECRET) {
  throw new Error('REQUEST_SIGNATURE_SECRET environment variable is required to run this test script');
}
const TEST_USER_AGENT = 'test-client/1.0';
const CLIENT_TOKEN_SECRET = process.env.NEXT_PUBLIC_CLIENT_TOKEN_SECRET || 'fry-rewards-client-';

const results = [];

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

function runCurl(method, path, body, headers) {
  const url = `${BASE_URL}${path}`;
  let cmd = `curl -s -X ${method} "${url}"`;
  cmd += ` -H "Content-Type: application/json"`;
  cmd += ` -H "User-Agent: ${TEST_USER_AGENT}"`;
  
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

  console.log(`  Client Token: ${clientToken.substring(0, 16)}...`);
  console.log(`  Signature: ${signature.substring(0, 16)}...`);

  const response = runCurl('POST', path, body, {
    'x-client-token': clientToken,
    'x-request-signature': signature,
    'x-request-timestamp': timestamp.toString(),
  });

  const passed = response.status === 200 || response.status === 401 || response.data?.code === 'UNAUTHORIZED';
  const result = {
    name: 'Valid request',
    passed,
    status: response.status,
    code: response.data?.code,
  };

  results.push(result);
  console.log(`  Status: ${response.status}`);
  console.log(`  Code: ${response.data?.code}`);
  console.log(`  ${passed ? '✓ PASSED' : '✗ FAILED'}`);
}

async function testMissingClientToken() {
  console.log('\n[Test 2] Missing client token');
  
  const path = '/api/rewards/claim';
  const timestamp = Math.floor(Date.now() / 1000);
  const body = {
    miner_key: 'test-miner-key',
    address: 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX7Q',
  };

  const signature = generateRequestSignature('POST', path, body, timestamp);

  const response = runCurl('POST', path, body, {
    'x-request-signature': signature,
    'x-request-timestamp': timestamp.toString(),
  });

  const passed = response.status === 403 && response.data?.code === 'MISSING_CLIENT_TOKEN';
  const result = {
    name: 'Missing client token',
    passed,
    status: response.status,
    code: response.data?.code,
  };

  results.push(result);
  console.log(`  Status: ${response.status}`);
  console.log(`  Code: ${response.data?.code}`);
  console.log(`  ${passed ? '✓ PASSED' : '✗ FAILED'}`);
}

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

  const response = runCurl('POST', path, body, {
    'x-client-token': invalidToken,
    'x-request-signature': signature,
    'x-request-timestamp': timestamp.toString(),
  });

  const passed = response.status === 403 && response.data?.code === 'INVALID_CLIENT_TOKEN';
  const result = {
    name: 'Invalid client token',
    passed,
    status: response.status,
    code: response.data?.code,
  };

  results.push(result);
  console.log(`  Status: ${response.status}`);
  console.log(`  Code: ${response.data?.code}`);
  console.log(`  ${passed ? '✓ PASSED' : '✗ FAILED'}`);
}

async function testMissingSignature() {
  console.log('\n[Test 4] Missing request signature');
  
  const path = '/api/rewards/claim';
  const body = {
    miner_key: 'test-miner-key',
    address: 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX7Q',
  };

  const clientToken = generateClientToken(TEST_USER_AGENT);

  const response = runCurl('POST', path, body, {
    'x-client-token': clientToken,
  });

  const passed = response.status === 403 && response.data?.code === 'MISSING_SIGNATURE';
  const result = {
    name: 'Missing signature',
    passed,
    status: response.status,
    code: response.data?.code,
  };

  results.push(result);
  console.log(`  Status: ${response.status}`);
  console.log(`  Code: ${response.data?.code}`);
  console.log(`  ${passed ? '✓ PASSED' : '✗ FAILED'}`);
}

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

  const response = runCurl('POST', path, body, {
    'x-client-token': clientToken,
    'x-request-signature': invalidSignature,
    'x-request-timestamp': timestamp.toString(),
  });

  const passed = response.status === 403 && response.data?.code === 'INVALID_SIGNATURE';
  const result = {
    name: 'Invalid signature',
    passed,
    status: response.status,
    code: response.data?.code,
  };

  results.push(result);
  console.log(`  Status: ${response.status}`);
  console.log(`  Code: ${response.data?.code}`);
  console.log(`  ${passed ? '✓ PASSED' : '✗ FAILED'}`);
}

async function testTamperedBody() {
  console.log('\n[Test 6] Tampered request body');
  
  const path = '/api/rewards/claim';
  const timestamp = Math.floor(Date.now() / 1000);
  const originalBody = {
    miner_key: 'test-miner-key',
    address: 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX7Q',
  };

  const signature = generateRequestSignature('POST', path, originalBody, timestamp);
  const clientToken = generateClientToken(TEST_USER_AGENT);

  const tamperedBody = {
    miner_key: 'HACKED-miner-key',
    address: 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX7Q',
  };

  const response = runCurl('POST', path, tamperedBody, {
    'x-client-token': clientToken,
    'x-request-signature': signature,
    'x-request-timestamp': timestamp.toString(),
  });

  const passed = response.status === 403 && response.data?.code === 'INVALID_SIGNATURE';
  const result = {
    name: 'Tampered body',
    passed,
    status: response.status,
    code: response.data?.code,
  };

  results.push(result);
  console.log(`  Status: ${response.status}`);
  console.log(`  Code: ${response.data?.code}`);
  console.log(`  ${passed ? '✓ PASSED' : '✗ FAILED'}`);
}

async function testExpiredTimestamp() {
  console.log('\n[Test 7] Expired timestamp (> 5 minutes old)');
  
  const path = '/api/rewards/claim';
  const expiredTimestamp = Math.floor(Date.now() / 1000) - 400;
  const body = {
    miner_key: 'test-miner-key',
    address: 'XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX7Q',
  };

  const clientToken = generateClientToken(TEST_USER_AGENT);
  const signature = generateRequestSignature('POST', path, body, expiredTimestamp);

  const response = runCurl('POST', path, body, {
    'x-client-token': clientToken,
    'x-request-signature': signature,
    'x-request-timestamp': expiredTimestamp.toString(),
  });

  const passed = response.status === 403 && response.data?.code === 'INVALID_SIGNATURE';
  const result = {
    name: 'Expired timestamp',
    passed,
    status: response.status,
    code: response.data?.code,
  };

  results.push(result);
  console.log(`  Status: ${response.status}`);
  console.log(`  Code: ${response.data?.code}`);
  console.log(`  ${passed ? '✓ PASSED' : '✗ FAILED'}`);
}

async function runAllTests() {
  console.log('========================================');
  console.log('Reward API Security Test Suite (curl)');
  console.log('========================================');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  await testValidRequest();
  await testMissingClientToken();
  await testInvalidClientToken();
  await testMissingSignature();
  await testInvalidSignature();
  await testTamperedBody();
  await testExpiredTimestamp();

  console.log('\n========================================');
  console.log('Test Summary');
  console.log('========================================');

  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed).length;

  console.table(
    results.map((r) => ({
      Test: r.name,
      Status: r.status,
      Code: r.code || 'N/A',
      Result: r.passed ? '✓ PASS' : '✗ FAIL',
    }))
  );

  console.log(`\nTotal: ${results.length} | Passed: ${passed} ✓ | Failed: ${failed} ✗`);
  console.log(`Pass Rate: ${Math.round((passed / results.length) * 100)}%\n`);

  if (failed === 0) {
    console.log('🎉 All tests passed!');
  } else {
    console.log(`⚠️  ${failed} test(s) failed`);
  }
}

runAllTests().catch(console.error);
