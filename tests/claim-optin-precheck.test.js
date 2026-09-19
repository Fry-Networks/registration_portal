const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// D1: a large claim spans several reward assets and is submitted as ONE atomic
// group -- a single leg whose destination wallet never opted into that ASA fails
// the whole group, so the user sees an opaque chain rejection instead of being
// told which asset to opt into. The claim handler must therefore check opt-in for
// EVERY asset in the claim BEFORE it builds the group, and the helper must report
// the specific asset rather than swallowing an algod outage as "not opted in".
const claimSrc = fs.readFileSync(
  path.join(__dirname, '..', 'pages', 'api', 'rewards', 'claim.ts'),
  'utf8'
);
const optInSrc = fs.readFileSync(
  path.join(__dirname, '..', 'lib', 'algorand', 'optIn.ts'),
  'utf8'
);

test('claim handler pre-checks opt-in for every asset in the claim', () => {
  assert.match(
    claimSrc,
    /for \(const assetId of summary\.map\(.*\)\) \{[\s\S]{0,120}?await ensureWalletAssetOptIn\(rewardWallet, assetId/,
    'claim.ts must loop the whole asset summary through ensureWalletAssetOptIn'
  );
});

test('opt-in pre-check runs before the atomic group is built', () => {
  const precheck = claimSrc.indexOf('ensureWalletAssetOptIn(rewardWallet');
  const groupBuild = claimSrc.indexOf('buildUserPaysClaimGroup(');
  assert.ok(precheck !== -1, 'ensureWalletAssetOptIn(rewardWallet, ...) not found');
  assert.ok(groupBuild !== -1, 'buildUserPaysClaimGroup( not found');
  assert.ok(
    precheck < groupBuild,
    'opt-in pre-check must run before buildUserPaysClaimGroup so a missing opt-in never reaches the chain'
  );
});

test('missing opt-in reports the offending asset id to the caller', () => {
  assert.match(optInSrc, /WALLET_ASSET_NOT_OPTED_IN/);
  assert.match(
    optInSrc,
    /assetId:\s*normalizedAssetId/,
    'the error payload must carry the un-opted asset id'
  );
});

test('an algod outage is never reported as "not opted in"', () => {
  assert.match(
    optInSrc,
    /err instanceof AlgodUnavailableError/,
    'AlgodUnavailableError must be distinguished from a genuine missing opt-in'
  );
  const outage = optInSrc.indexOf('AlgodUnavailableError');
  const notOptedIn = optInSrc.indexOf('WALLET_ASSET_NOT_OPTED_IN');
  assert.ok(
    outage < notOptedIn,
    'the outage branch must short-circuit before the not-opted-in branch'
  );
});
