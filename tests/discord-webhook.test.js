const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });

const originalFetch = global.fetch;
const {
  notifyDiscordError,
  __resetDiscordRateLimiterForTests,
  discordWebhookConfig,
  __setDiscordWebhookUrlForTests,
  __getDiscordWebhookUrlForTests,
} = require('../lib/discord-webhook.ts');

const originalWebhookUrl = __getDiscordWebhookUrlForTests();

const buildErrorDetails = (overrides = {}) => ({
  minerKey: 'TEST_MINER',
  walletAddress: 'TEST_WALLET',
  issueType: 'TEST_ERROR',
  part: 'tests.discord',
  errorMessage: 'Example error',
  ...overrides,
});

test('rate limiter drops requests beyond the configured threshold', async () => {
  __setDiscordWebhookUrlForTests('https://example.com/webhook');
  __resetDiscordRateLimiterForTests();

  const calls = [];
  global.fetch = async (input, init) => {
    calls.push({ ...(init || {}), url: typeof input === 'string' ? input : input.toString() });
    return {
      ok: true,
      json: async () => ({}),
    };
  };

  const now = Date.now();
  const details = buildErrorDetails();

  for (let i = 0; i < 25; i++) {
    await notifyDiscordError({
      ...details,
      errorMessage: `Example error #${i}`,
      timestamp: new Date(now + i).toISOString(),
    });
  }

  assert.equal(calls.length, 20, 'expected only 20 webhook calls due to rate limiting');
  assert.ok(discordWebhookConfig.stats.dropped >= 5, 'expected dropped counter to reflect limited requests');
});

test('rate limiter allows bursts after window reset', async () => {
  __setDiscordWebhookUrlForTests('https://example.com/webhook');
  __resetDiscordRateLimiterForTests();

  let callCount = 0;
  global.fetch = async () => {
    callCount += 1;
    return {
      ok: true,
      json: async () => ({}),
    };
  };

  const details = buildErrorDetails();

  for (let i = 0; i < 10; i++) {
    await notifyDiscordError({ ...details, errorMessage: `Burst1-${i}` });
  }
  assert.equal(callCount, 10);

  __resetDiscordRateLimiterForTests();

  for (let i = 0; i < 5; i++) {
    await notifyDiscordError({ ...details, errorMessage: `Burst2-${i}` });
  }
  assert.equal(callCount, 15, 'second burst should be permitted after reset');
});

test('rate limiter no-ops if webhook URL missing', async () => {
  __setDiscordWebhookUrlForTests('');
  __resetDiscordRateLimiterForTests();

  assert.equal(discordWebhookConfig.isConfigured, false);

  let called = 0;
  global.fetch = async () => {
    called += 1;
    return {
      ok: true,
      json: async () => ({}),
    };
  };

  await notifyDiscordError(buildErrorDetails());
  assert.equal(called, 0, 'should skip when webhook url not configured');
});

test.after(async () => {
  __setDiscordWebhookUrlForTests(originalWebhookUrl);
  global.fetch = originalFetch;
});
