// @ts-check

/**
 * Reward-row reservation.
 *
 * A claim used to leave its reward rows on `status: 'claimable'` until a *successful* confirm
 * marked them `claimed`. Every path that skipped that confirm — a burst of claims, a group the
 * wallet submitted without calling /confirm, an envelope that expired after payment — re-selected
 * the same rows and minted another payable envelope. That is how one entitlement was paid nine
 * times.
 *
 * Reserving at mint time moves the guard onto the thing actually being double-spent. Rows leave
 * `claimable` in the same request that creates the envelope, so a second claim cannot see them
 * again regardless of envelope lifecycle, expiry, or whether confirm ever runs.
 */

const CLAIMABLE = 'claimable';
const CLAIMING = 'claiming';
const CLAIMED = 'claimed';

/** Statuses a claimed-write is allowed to settle from. */
const SETTLEABLE_FROM = [CLAIMABLE, CLAIMING];

/**
 * @typedef {Object} RewardRecord
 * @property {string} source  'weekly' | 'daily'
 * @property {number} reward_number
 */

/** @param {RewardRecord[]} records @param {string} source */
function numbersFor(records, source) {
    return (records || []).filter((r) => r.source === source).map((r) => r.reward_number);
}

/**
 * Flip the given rows claimable -> claiming, stamped with the group that reserved them.
 * Returns the number of rows reserved so the caller can refuse to mint on a short match.
 *
 * @param {any} rewardsCollection
 * @param {string} minerKey
 * @param {RewardRecord[]} records
 * @param {string} groupId
 * @param {Date} [now]
 */
async function reserveRows(rewardsCollection, minerKey, records, groupId, now = new Date()) {
    let reserved = 0;
    for (const source of ['weekly', 'daily']) {
        const nos = numbersFor(records, source);
        if (!nos.length) continue;
        const arr = source === 'weekly' ? 'weekly_rewards' : 'daily_rewards';
        const res = await rewardsCollection.updateOne(
            { miner_key: minerKey },
            {
                $set: {
                    [`${arr}.$[elem].status`]: CLAIMING,
                    [`${arr}.$[elem].claiming_group`]: groupId,
                    [`${arr}.$[elem].claiming_at`]: now
                }
            },
            {
                arrayFilters: [{
                    'elem.reward_number': { $in: nos },
                    'elem.status': CLAIMABLE,
                    // The claim.ts snapshot (records/summary/assetLegs) is taken once and reused
                    // across a chain of awaited algod round-trips before this call runs. These
                    // four fields are written only by the external reward pipeline (never by this
                    // app) and mirror lib/rewards/effective.ts's isVoided/isHeld: if the pipeline
                    // voided or held a row during that window, `status` alone would still read
                    // `claimable` and let it reserve at its stale, already-decided-against amount.
                    // Re-checking them here makes the failure mode "this row does not reserve"
                    // (nothing written, nothing to strand) instead of "reserve it anyway".
                    'elem.voided_by': { $exists: false },
                    'elem.payout_hold': { $ne: true },
                    'elem.ghost_device': { $ne: true },
                    'elem.evidence_unavailable': { $ne: true }
                }]
            }
        );
        // modifiedCount is per document, not per array element, so count the intent instead: a
        // short reservation shows up as rows still claimable, which the caller re-reads.
        if (res.modifiedCount) reserved += nos.length;
    }
    return reserved;
}

/**
 * Hand rows back to `claimable` after a mint failed. Only rows still held by THIS group are
 * released, so a later claim's reservation is never disturbed.
 *
 * @param {any} rewardsCollection
 * @param {string} minerKey
 * @param {RewardRecord[]} records
 * @param {string} groupId
 */
async function releaseRows(rewardsCollection, minerKey, records, groupId) {
    for (const source of ['weekly', 'daily']) {
        const nos = numbersFor(records, source);
        if (!nos.length) continue;
        const arr = source === 'weekly' ? 'weekly_rewards' : 'daily_rewards';
        await rewardsCollection.updateOne(
            { miner_key: minerKey },
            {
                $set: { [`${arr}.$[elem].status`]: CLAIMABLE },
                $unset: { [`${arr}.$[elem].claiming_group`]: '', [`${arr}.$[elem].claiming_at`]: '' }
            },
            {
                arrayFilters: [
                    { 'elem.reward_number': { $in: nos }, 'elem.status': CLAIMING, 'elem.claiming_group': groupId }
                ]
            }
        );
    }
}

/**
 * An expired reservation may only be released when nothing was paid for it. `paid` is the caller's
 * chain answer; releasing on an unknown answer would re-open the exact hole this module closes.
 *
 * @param {{ paid: boolean | null | undefined }} evidence
 */
function mayReleaseExpiredReservation(evidence) {
    return evidence != null && evidence.paid === false;
}

module.exports = {
    CLAIMABLE,
    CLAIMING,
    CLAIMED,
    SETTLEABLE_FROM,
    numbersFor,
    reserveRows,
    releaseRows,
    mayReleaseExpiredReservation
};

/**
 * Release reservations that can no longer belong to a live claim.
 *
 * Without this, an abandoned claim would strand its reward rows in `claiming` forever. The release
 * is deliberately conservative: a row is only freed when its envelope is gone AND the row carries
 * no tx_id. A paid-but-unconfirmed claim still has its envelope (confirm deletes it only after a
 * successful submit), so those rows are never touched.
 *
 * @param {any} rewardsCollection
 * @param {any} pendingCollection
 * @param {string} minerKey
 */
async function releaseStaleReservations(rewardsCollection, pendingCollection, minerKey) {
    const doc = await rewardsCollection.findOne({ miner_key: minerKey });
    if (!doc) return 0;

    /** @type {Set<string>} */
    const stale = new Set();
    for (const arr of ['weekly_rewards', 'daily_rewards']) {
        for (const row of doc[arr] || []) {
            if (row.status === CLAIMING && row.claiming_group && !row.tx_id) {
                stale.add(row.claiming_group);
            }
        }
    }
    if (!stale.size) return 0;

    let released = 0;
    for (const groupId of stale) {
        const envelope = await pendingCollection.findOne({ groupId });
        if (envelope) continue; // a live claim still owns these rows
        for (const arr of ['weekly_rewards', 'daily_rewards']) {
            await rewardsCollection.updateOne(
                { miner_key: minerKey },
                {
                    $set: { [`${arr}.$[elem].status`]: CLAIMABLE },
                    $unset: { [`${arr}.$[elem].claiming_group`]: '', [`${arr}.$[elem].claiming_at`]: '' }
                },
                {
                    arrayFilters: [
                        { 'elem.status': CLAIMING, 'elem.claiming_group': groupId, 'elem.tx_id': { $exists: false } }
                    ]
                }
            );
        }
        released += 1;
    }
    return released;
}

module.exports.releaseStaleReservations = releaseStaleReservations;
