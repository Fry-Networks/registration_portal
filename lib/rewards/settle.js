// @ts-check

/**
 * Settle exactly the reward rows a claim paid.
 *
 * The old settle wrote status:'claimed' through arrayFilters keyed on reward_number alone and
 * accepted rows still 'claimable'. reward_number is not unique inside a device's reward arrays, so
 * one paid claim could close sibling entitlements it never reserved and never paid (and stamp the
 * paid record's amount onto them as claimed_amount).
 *
 * This helper reads the device document once, resolves every paid record to exactly one element,
 * and writes each element through an arrayFilter pinned to that element's stored identity
 * (_id + week_start|date + status [+ claiming_group]). Anything it cannot resolve to exactly one
 * element is left untouched and reported, never guessed. It never throws.
 *
 * Deliberately self-contained: it does not require ./reservation (tests stub that module) and it
 * mirrors lib/rewards/effective.ts effectiveAmount rather than importing TypeScript.
 */

const CLAIMABLE = 'claimable';
const CLAIMING = 'claiming';
const CLAIMED = 'claimed';

const ARR = { weekly: 'weekly_rewards', daily: 'daily_rewards' };
const EPOCH = { weekly: 'week_start', daily: 'date' };

/** Issue codes that do not block envelope deletion: the paid rows all settled. */
const NON_BLOCKING = new Set(['EXTRA_RESERVED', 'AMOUNT_DRIFT']);

/** @param {any} row */
const effectiveAmount = (row) =>
    typeof row?.corrected_amount === 'number' ? row.corrected_amount : Number(row?.amount ?? 0);

/** Micro-units (6 dp): record amounts are raw effectiveAmount values, not 2-dp display values. */
/** @param {any} v */
const micro = (v) => Math.round(Number(v) * 1e6);

/** @param {any} v */
const isOid = (v) => !!v && typeof v === 'object' && (v._bsontype === 'ObjectId' || v._bsontype === 'ObjectID');

/** @param {any} a @param {any} b */
function bsonEq(a, b) {
    if (a instanceof Date || b instanceof Date) return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
    if (isOid(a) || isOid(b)) return isOid(a) && isOid(b) && a.toHexString() === b.toHexString();
    return a === b;
}

/** @param {any} have @param {any} want */
function valueMatches(have, want) {
    if (want === null) return have === null || have === undefined;
    if (want && typeof want === 'object' && !(want instanceof Date) && !isOid(want)) {
        if ('$exists' in want) return (have !== undefined) === want.$exists;
        throw new Error('settle: unsupported operator in pin');
    }
    return bsonEq(have, want);
}

/** @param {any} e @param {Record<string, any>} pin */
function elemMatches(e, pin) {
    return !!e && typeof e === 'object' && Object.entries(pin).every(([k, w]) => valueMatches(e[k.slice(5)], w));
}

/**
 * The arrayFilter that addresses exactly one element: values are taken from the stored element as
 * read (no Date re-wrapping, no string conversion) so BSON types match exactly. A missing field is
 * pinned with {$exists:false}, never undefined (the driver would serialise undefined as null).
 * @param {any} e @param {'weekly'|'daily'} source @param {string} status @param {string|null} groupId
 */
function pinFor(e, source, status, groupId) {
    const ep = EPOCH[source];
    /** @type {Record<string, any>} */
    const pin = { 'elem.reward_number': e.reward_number, 'elem.status': status };
    if (groupId) pin['elem.claiming_group'] = groupId;
    pin['elem._id'] = e._id === undefined ? { $exists: false } : e._id;
    pin[`elem.${ep}`] = e[ep] === undefined ? { $exists: false } : e[ep];
    return pin;
}

/** @param {any} v */
const epochOf = (v) => (v instanceof Date ? v.toISOString() : v === undefined ? null : v);

/** @param {any} e @param {string} source @param {any} amount */
const describe = (e, source, amount) => ({
    source,
    reward_number: e?.reward_number,
    epoch: epochOf(e?.[EPOCH[/** @type {'weekly'|'daily'} */ (source)]]),
    elem_id: e?._id === undefined ? null : String(e._id),
    amount
});

/**
 * Pure: decide which elements a paid claim settles, from one snapshot of the device document.
 * User-pays mode (groupId): each record resolves among rows with status 'claiming' and
 * claiming_group === groupId, matched by (source, reward_number, micro amount, asset).
 * Custodial mode (selected): records[i] is settled as selected[i] (the exact row the claim chose),
 * pinned with status 'claimable'.
 * @param {any} doc
 * @param {{ txId: string, records: any[], groupId?: string, selected?: any[] }} opts
 */
function planSettle(doc, opts) {
    const { txId, records, groupId, selected } = opts;
    /** @type {Map<any, {source: 'weekly'|'daily', amount: number, status: string, group: string|null}>} */
    const chosen = new Map();
    /** @type {Map<string, any[]>} */
    const issues = new Map();
    const issue = (/** @type {string} */ code, /** @type {any} */ item) => {
        if (!issues.has(code)) issues.set(code, []);
        /** @type {any[]} */ (issues.get(code)).push(item);
    };
    let alreadySettled = 0;
    const custodial = Array.isArray(selected);

    if (!custodial && (typeof groupId !== 'string' || !groupId)) { issue('NO_GROUP', {}); return { chosen, alreadySettled, issues }; }
    if (!Array.isArray(records) || records.length === 0) { issue('NO_RECORDS', {}); return { chosen, alreadySettled, issues }; }
    if (!doc) { issue('DOC_MISSING', {}); return { chosen, alreadySettled, issues }; }
    for (const r of records) {
        if ((r?.source !== 'weekly' && r?.source !== 'daily') || typeof r?.reward_number !== 'number') {
            issue('BAD_RECORD', { source: r?.source, reward_number: r?.reward_number });
        }
    }
    if (issues.has('BAD_RECORD')) return { chosen, alreadySettled, issues };

    if (custodial) {
        const sel = /** @type {any[]} */ (selected);
        if (sel.length !== records.length) { issue('SELECTION_MISMATCH', { selected: sel.length, records: records.length }); return { chosen, alreadySettled, issues }; }
        for (let i = 0; i < records.length; i++) {
            if (sel[i]?.reward_number !== records[i].reward_number || micro(effectiveAmount(sel[i])) !== micro(records[i].amount)) {
                issue('SELECTION_MISMATCH', describe(sel[i], records[i].source, records[i].amount));
            }
        }
        if (issues.has('SELECTION_MISMATCH')) return { chosen, alreadySettled, issues };
        for (let i = 0; i < records.length; i++) {
            const r = records[i]; const source = /** @type {'weekly'|'daily'} */ (r.source); const arr = doc[ARR[source]] || [];
            const pin = pinFor(sel[i], source, CLAIMABLE, null);
            const live = arr.filter((/** @type {any} */ e) => elemMatches(e, pin));
            const k = sel.filter((s, j) => records[j].source === source && elemMatches(s, pin)).length;
            if (live.length !== k) { issue(live.length === 0 ? 'ROW_CHANGED' : 'PIN_NOT_UNIQUE', describe(sel[i], source, r.amount)); continue; }
            const pick = live.find((/** @type {any} */ e) => !chosen.has(e));
            if (!pick) { issue('PIN_NOT_UNIQUE', describe(sel[i], source, r.amount)); continue; }
            if (micro(effectiveAmount(pick)) !== micro(r.amount)) issue('AMOUNT_DRIFT', describe(pick, source, r.amount));
            chosen.set(pick, { source, amount: r.amount, status: CLAIMABLE, group: null });
        }
        return { chosen, alreadySettled, issues };
    }

    // user-pays: bucket identical records, resolve each bucket inside this group's reservation
    /** @type {Map<string, any[]>} */
    const buckets = new Map();
    for (const r of records) {
        const key = [r.source, r.reward_number, micro(r.amount), String(r.asset_id ?? '')].join('|');
        if (!buckets.has(key)) buckets.set(key, []);
        /** @type {any[]} */ (buckets.get(key)).push(r);
    }
    const counted = new Set();
    const failed = new Set();
    for (const rs of buckets.values()) {
        const r0 = rs[0]; const source = /** @type {'weekly'|'daily'} */ (r0.source); const arr = doc[ARR[source]] || [];
        const m = micro(r0.amount); const asset = String(r0.asset_id ?? '');
        const assetOk = (/** @type {any} */ e) => asset === '' || String(e.asset_id ?? '') === asset;
        const cands = arr.filter((/** @type {any} */ e) => e && e.reward_number === r0.reward_number && e.claiming_group === groupId);
        const done = cands.filter((/** @type {any} */ e) => e.status === CLAIMED && e.tx_id === txId && micro(e.claimed_amount) === m && assetOk(e) && !counted.has(e));
        const consumed = Math.min(done.length, rs.length);
        done.slice(0, consumed).forEach((/** @type {any} */ e) => counted.add(e));
        alreadySettled += consumed;
        const need = rs.length - consumed;
        if (need === 0) continue;
        const reserved = cands.filter((/** @type {any} */ e) => e.status === CLAIMING);
        const eligible = reserved.filter((/** @type {any} */ e) => !chosen.has(e) && micro(effectiveAmount(e)) === m && assetOk(e));
        if (eligible.length === 0) {
            issue(reserved.length ? 'AMOUNT_MISMATCH' : 'NO_RESERVED_ROW', describe({ reward_number: r0.reward_number }, source, r0.amount));
            reserved.forEach((/** @type {any} */ e) => failed.add(e));
            continue;
        }
        if (eligible.length > need) {
            issue('AMBIGUOUS', { ...describe({ reward_number: r0.reward_number }, source, r0.amount), candidates: eligible.length, needed: need });
            reserved.forEach((/** @type {any} */ e) => failed.add(e));
            continue;
        }
        eligible.forEach((/** @type {any} */ e) => chosen.set(e, { source, amount: r0.amount, status: CLAIMING, group: groupId || null }));
        if (eligible.length < need) issue('NO_RESERVED_ROW', { ...describe({ reward_number: r0.reward_number }, source, r0.amount), missing: need - eligible.length });
    }
    for (const source of /** @type {Array<'weekly'|'daily'>} */ (['weekly', 'daily'])) {
        for (const e of doc[ARR[source]] || []) {
            if (e && e.status === CLAIMING && e.claiming_group === groupId && !chosen.has(e) && !failed.has(e)) {
                issue('EXTRA_RESERVED', describe(e, source, effectiveAmount(e)));
            }
        }
    }
    return { chosen, alreadySettled, issues };
}

/**
 * Settle the rows a paid claim covered. Never throws: every problem becomes an issue, and
 * `clean` is true only when every paid record settled (or was already settled by this txId).
 * @param {any} rewardsCollection
 * @param {{ minerKey: string, txId: string, claimedAt: Date, records: any[], groupId?: string, selected?: any[] }} opts
 * @returns {Promise<{ settled: number, alreadySettled: number, clean: boolean, issues: Array<{ code: string, count: number, items: any[] }> }>}
 */
async function settleRows(rewardsCollection, opts) {
    const { minerKey, txId, claimedAt, records, groupId, selected } = opts;
    const out = { settled: 0, alreadySettled: 0, clean: false, issues: /** @type {Array<{code: string, count: number, items: any[]}>} */ ([]) };
    /** @type {Map<string, any[]>} */
    let issues = new Map();
    const add = (/** @type {string} */ code, /** @type {any} */ item) => {
        if (!issues.has(code)) issues.set(code, []);
        /** @type {any[]} */ (issues.get(code)).push(item);
    };
    try {
        const doc = await rewardsCollection.findOne({ miner_key: minerKey }, { projection: { weekly_rewards: 1, daily_rewards: 1 } });
        const plan = planSettle(doc, { txId, records, groupId, selected });
        issues = plan.issues;
        out.alreadySettled = plan.alreadySettled;
        const written = new Set();
        for (const [elem, a] of plan.chosen) {
            if (written.has(elem)) continue;
            const arr = ARR[a.source];
            const pin = pinFor(elem, a.source, a.status, a.group);
            const hits = (doc[arr] || []).filter((/** @type {any} */ e) => elemMatches(e, pin));
            hits.forEach((/** @type {any} */ h) => written.add(h));
            if (!hits.length || !hits.every((/** @type {any} */ h) => plan.chosen.has(h) && micro(/** @type {any} */ (plan.chosen.get(h)).amount) === micro(a.amount))) {
                add('PIN_NOT_UNIQUE', describe(elem, a.source, a.amount));
                continue;
            }
            try {
                const filter = doc._id !== undefined ? { _id: doc._id, miner_key: minerKey } : { miner_key: minerKey };
                const res = await rewardsCollection.updateOne(
                    filter,
                    { $set: {
                        [`${arr}.$[elem].status`]: CLAIMED,
                        [`${arr}.$[elem].tx_id`]: txId,
                        [`${arr}.$[elem].claimed_at`]: claimedAt,
                        [`${arr}.$[elem].claimed_amount`]: a.amount
                    } },
                    { arrayFilters: [pin] }
                );
                if (res && res.modifiedCount) out.settled += hits.length;
                else add('RACE', describe(elem, a.source, a.amount));
            } catch (err) {
                add('WRITE_FAILED', { ...describe(elem, a.source, a.amount), error: String(/** @type {any} */ (err)?.message || err) });
            }
        }
    } catch (err) {
        add('FAILED', { error: String(/** @type {any} */ (err)?.message || err) });
    }
    out.issues = Array.from(issues.entries()).map(([code, items]) => ({ code, count: items.length, items: items.slice(0, 50) }));
    out.clean = !out.issues.some((i) => !NON_BLOCKING.has(i.code));
    return out;
}

module.exports = { settleRows, planSettle, pinFor, elemMatches, effectiveAmount, micro, NON_BLOCKING };
