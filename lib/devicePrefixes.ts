/**
 * Single source of truth for the miner-key prefix classes that decide which REWARD ASSET a
 * device's rewards are denominated in.
 *
 * This mapping is money-affecting. Five files previously carried byte-identical private copies
 * (pages/history.tsx, pages/api/rewards/get-asset-totals.ts, pages/api/rewards/claim.ts,
 * pages/api/rewards/get-reward-summary.ts, pages/api/rewards/get-reward-summary-batch.ts).
 * Copies that drift apart would let a device be paid from one asset pool and accounted against
 * another, so they are consolidated here.
 *
 * The classification every consumer performs is three-way:
 *
 *     isNode   = NODE_PREFIXES.has(prefix)
 *     isAem    = prefix === AEM_PREFIX || prefix === FEM_PREFIX   -> fNODE bucket
 *     isMiner  = !(isNode || isAem)                               -> tFRY bucket
 *
 * BM therefore settles in tFRY and FEM in fNODE BY DESIGN -- that is the intended product
 * behaviour, not an oversight, and it must not be "tidied up". Changing membership of these
 * sets changes which asset real users are paid in; tests/reward-bucket-mapping.test.js pins the
 * resulting bucket for every known prefix so an accidental edit fails loudly.
 *
 * ReadonlySet so a consumer cannot mutate the shared instance for everyone else.
 */
export const NODE_PREFIXES: ReadonlySet<string> = new Set(['RDN', 'SVN', 'SDN', 'CN']);

export const AEM_PREFIX = 'AEM';
export const FEM_PREFIX = 'FEM';
