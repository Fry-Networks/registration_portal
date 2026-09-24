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
const NON_BLOCKING = new Set(['EXTRA_RESERVED', 'AMOUNT_DRIFT', 'ROW_DRIFT']);

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

/**
 * Full stored-element equality (every field, both directions), BSON-aware: Date by time, ObjectId by hex,
 * nested objects/arrays recursively. Used to find the exact element a custodial claim selected.
 * @param {any} a @param {any} b @returns {boolean}
 */
function sameElement(a, b) {
    if (a instanceof Date || b instanceof Date || isOid(a) || isOid(b)) return bsonEq(a, b);
    if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => sameElement(x, b[i]));
    if (a && b && typeof a === 'object' && typeof b === 'object') {
        const ka = Object.keys(a).filter((k) => a[k] !== undefined); const kb = Object.keys(b).filter((k) => b[k] !== undefined);
        return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && sameElement(a[k], b[k]));
    }
    return a === b;
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

/**
 * Filter for a positional write to arr.<index>: the element at that index must still be the resolved element
 * (reward_number, status, claiming_group when reserved, _id, epoch — values exactly as read).
 * @param {any} e @param {'weekly'|'daily'} source @param {number} index @param {string} status @param {string|null} groupId
 */
function positionalGuard(e, source, index, status, groupId) {
    const base = `${ARR[source]}.${index}`; const pin = pinFor(e, source, status, groupId);
    /** @type {Record<string, any>} */
    const g = {};
    for (const [k, v] of Object.entries(pin)) g[`${base}.${k.slice(5)}`] = v;
    return g;
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
    const validSource = (/** @type {any} */ r) => r?.source === 'weekly' || r?.source === 'daily';

    if (custodial) {
        // Per record: a bad or misaligned record is reported and skipped; every other paid row still settles.
        const sel = /** @type {any[]} */ (selected);
        if (sel.length !== records.length) { issue('SELECTION_MISMATCH', { selected: sel.length, records: records.length }); return { chosen, alreadySettled, issues }; }
        /** @type {Record<string, Set<number>>} */
        const taken = { weekly: new Set(), daily: new Set() };
        for (let i = 0; i < records.length; i++) {
            const r = records[i];
            if (!validSource(r)) { issue('BAD_RECORD', { source: r?.source, reward_number: r?.reward_number }); continue; }
            const source = /** @type {'weekly'|'daily'} */ (r.source);
            if (!sel[i] || sel[i].reward_number !== r.reward_number || micro(effectiveAmount(sel[i])) !== micro(r.amount)) { issue('SELECTION_MISMATCH', describe(sel[i], source, r.amount)); continue; }
            const arr = doc[ARR[source]] || [];
            // the exact element the claim selected: status still claimable and every stored field equal to the snapshot
            let idx = arr.findIndex((/** @type {any} */ e, /** @type {number} */ j) => !taken[source].has(j) && e && e.status === CLAIMABLE && sameElement(e, sel[i]));
            if (idx < 0) {
                // The row was PAID; if a field changed since the snapshot (e.g. corrected_amount) it must still settle,
                // or it stays claimable and payable twice. Fall back to its identity (reward_number, _id, week_start|date),
                // but only when every stored element with that identity was itself selected by this claim: then any
                // still-claimable one is a paid row, and an unselected (e.g. held) twin can never be settled in its place.
                const pin = pinFor(sel[i], source, CLAIMABLE, null);
                /** @type {Record<string, any>} */
                const idPin = { ...pin }; delete idPin['elem.status'];
                const stored = arr.filter((/** @type {any} */ e) => elemMatches(e, idPin)).length;
                const picked = records.filter((/** @type {any} */ rr, /** @type {number} */ j) => rr?.source === source && elemMatches(sel[j], idPin)).length;
                const cands = arr.map((/** @type {any} */ e, /** @type {number} */ j) => j).filter((/** @type {number} */ j) => !taken[source].has(j) && elemMatches(arr[j], pin));
                if (stored !== picked || cands.length === 0) { issue(stored !== picked ? 'PIN_NOT_UNIQUE' : 'ROW_CHANGED', describe(sel[i], source, r.amount)); continue; }
                idx = cands.find((/** @type {number} */ j) => micro(effectiveAmount(arr[j])) === micro(r.amount)) ?? cands[0];
                issue(micro(effectiveAmount(arr[idx])) === micro(r.amount) ? 'ROW_DRIFT' : 'AMOUNT_DRIFT', describe(arr[idx], source, r.amount));
            }
            taken[source].add(idx);
            chosen.set(arr[idx], { source, amount: r.amount, status: CLAIMABLE, group: null, index: idx });
        }
        return { chosen, alreadySettled, issues };
    }

    for (const r of records) {
        if (!validSource(r) || typeof r?.reward_number !== 'number') issue('BAD_RECORD', { source: r?.source, reward_number: r?.reward_number });
    }
    // user-pays: bucket identical records, resolve each bucket inside this group's reservation
    /** @type {Map<string, any[]>} */
    const buckets = new Map();
    for (const r of records) {
        if (!validSource(r) || typeof r?.reward_number !== 'number') continue;
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
        eligible.forEach((/** @type {any} */ e) => chosen.set(e, { source, amount: r0.amount, status: CLAIMING, group: groupId || null, index: arr.indexOf(e) }));
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
        for (const [elem, a] of plan.chosen) {
            const arr = ARR[a.source]; const base = `${arr}.${a.index}`;
            if (typeof a.index !== 'number' || a.index < 0 || (doc[arr] || [])[a.index] !== elem) { add('PIN_NOT_UNIQUE', describe(elem, a.source, a.amount)); continue; }
            try {
                const filter = { ...(doc._id !== undefined ? { _id: doc._id } : {}), miner_key: minerKey, ...positionalGuard(elem, a.source, a.index, a.status, a.group) };
                const res = await rewardsCollection.updateOne(filter, { $set: {
                    [`${base}.status`]: CLAIMED,
                    [`${base}.tx_id`]: txId,
                    [`${base}.claimed_at`]: claimedAt,
                    [`${base}.claimed_amount`]: a.amount
                } });
                if (res && res.modifiedCount) out.settled += 1;
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

module.exports = { settleRows, planSettle, pinFor, positionalGuard, sameElement, elemMatches, effectiveAmount, micro, NON_BLOCKING };
