const test = require('node:test');
const assert = require('node:assert/strict');

require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });

const { handleApiError, createApiError, ErrorCodes } = require('../lib/api-errors.ts');
const loggerModule = require('../lib/logger.ts');

const mockResponse = () => {
  return {
    statusCode: 0,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.payload = body;
      return this;
    },
  };
};

test('handleApiError logs metadata and returns sanitized payload', () => {
  const res = mockResponse();
  const originalLogger = loggerModule.loggers.apiError;
  const calls = [];
  loggerModule.loggers.apiError = (endpoint, err, metadata) => {
    calls.push({ endpoint, err, metadata });
  };

  const responsePayload = createApiError(
    ErrorCodes.INVALID_INPUT,
    'Invalid request',
    'Fix input'
  );

  handleApiError(
    res,
    '/api/test-endpoint',
    new Error('Broken'),
    {
      status: 422,
      response: responsePayload,
      minerKey: 'MINER123',
      walletAddress: 'ADDR1',
      issueType: 'TEST_ERROR',
      part: 'unit-test',
      metadata: { foo: 'bar' },
    }
  );

  assert.equal(res.statusCode, 422);
  assert.deepEqual(res.payload, responsePayload);
  assert.equal(calls.length, 1);
  const { endpoint, metadata } = calls[0];
  assert.equal(endpoint, '/api/test-endpoint');
  assert.equal(metadata.minerKey, 'MINER123');
  assert.equal(metadata.walletAddress, 'ADDR1');
  assert.equal(metadata.issueType, 'TEST_ERROR');
  assert.equal(metadata.part, 'unit-test');
  assert.equal(metadata.foo, 'bar');

  loggerModule.loggers.apiError = originalLogger;
});
