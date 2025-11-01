// @ts-check

/**
 * @typedef {'staked' | 'withdrawn'} StakeAction
 *
 * @typedef {Object} StakeEvent
 * @property {StakeAction} action
 * @property {number} amount
 * @property {string} txId
 * @property {string} time
 * @property {string | undefined} assetId
 * @property {string | undefined} lockType
 *
 * @typedef {Object} StakeFieldRecord
 * @property {number | undefined} amount
 * @property {string | undefined} asset_id
 * @property {string | undefined} txId
 * @property {string | undefined} time
 * @property {string | undefined} type
 *
 * @typedef {StakeFieldRecord & {
 *   history?: Array<StakeFieldRecord>;
 *   withdrawals?: Array<StakeFieldRecord>;
 *   lastWithdrawal?: StakeFieldRecord | null;
 * }} StakeField
 *
 * @typedef {{ verification: StakeEvent[]; registration: StakeEvent[]; node: StakeEvent[] }} StakeHistoryMap
 */

/** @param {unknown} input */
const toISOString = (input) => {
  if (!input) return undefined;
  let date;
  if (input instanceof Date) {
    date = input;
  } else if (typeof input === 'string' || typeof input === 'number') {
    date = new Date(input);
  } else {
    return undefined;
  }
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
};

/** @param {unknown} value */
const toFiniteNumber = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

/**
 * Normalises an individual stake field (verification, registration, node) into chronological entries.
 * @param {StakeField | undefined | null} source
 * @returns {StakeEvent[]}
 */
function buildStakeEvents(source) {
  if (!source) return [];

  /** @type {StakeEvent[]} */
  const events = [];

  const history = Array.isArray(source.history) ? source.history : [];
  const withdrawals = Array.isArray(source.withdrawals) ? source.withdrawals : [];

  for (const entry of history) {
    if (!entry || !entry.txId) continue;
    const time = toISOString(entry.time);
    if (!time) continue;
    const amount = toFiniteNumber(entry.amount) ?? 0;
    events.push({
      action: 'staked',
      amount,
      assetId: entry.asset_id,
      txId: entry.txId,
      time,
      lockType: entry.type
    });
  }

  if (source.txId) {
    const time = toISOString(source.time);
    const stakeAmount = toFiniteNumber(source.amount);

    const latestHistory = history.length > 0 ? history[history.length - 1] : undefined;
    const fallbackAmount =
      (stakeAmount && stakeAmount > 0 ? stakeAmount : undefined) ??
      toFiniteNumber(source.lastWithdrawal?.amount) ??
      toFiniteNumber(withdrawals.length > 0 ? withdrawals[withdrawals.length - 1]?.amount : undefined) ??
      toFiniteNumber(latestHistory?.amount) ??
      0;

    const resolvedAmount =
      stakeAmount && stakeAmount > 0 ? stakeAmount : fallbackAmount;

    const latestWithdrawalEntry = withdrawals.length > 0 ? withdrawals[withdrawals.length - 1] : undefined;

    const resolvedLockType =
      source.type ??
      source.lastWithdrawal?.type ??
      latestWithdrawalEntry?.type ??
      latestHistory?.type;

    if (time && resolvedAmount > 0) {
      events.push({
        action: 'staked',
        amount: resolvedAmount,
        assetId: source.asset_id,
        txId: source.txId,
        time,
        lockType: resolvedLockType
      });
    }
  }

  for (const entry of withdrawals) {
    if (!entry || !entry.txId) continue;
    const time = toISOString(entry.time);
    if (!time) continue;
    const amount = toFiniteNumber(entry.amount) ?? 0;
    events.push({
      action: 'withdrawn',
      amount,
      assetId: entry.asset_id ?? source.asset_id,
      txId: entry.txId,
      time,
      lockType: entry.type ?? source.type
    });
  }

  if (source.lastWithdrawal && source.lastWithdrawal.txId) {
    const alreadyTracked = withdrawals.some(
      (entry) => entry?.txId && entry.txId === source.lastWithdrawal?.txId
    );
    if (!alreadyTracked) {
      const time = toISOString(source.lastWithdrawal.time);
      if (time) {
        const amount = toFiniteNumber(source.lastWithdrawal.amount) ?? 0;
        events.push({
          action: 'withdrawn',
          amount,
          assetId: source.lastWithdrawal.asset_id ?? source.asset_id,
          txId: source.lastWithdrawal.txId,
          time,
          lockType: source.lastWithdrawal.type ?? source.type
        });
      }
    }
  }

  events.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  return events;
}

/**
 * Builds the full stake history payload expected by the history page.
 * @param {any} device
 * @returns {StakeHistoryMap}
 */
function collectStakeHistory(device) {
  return {
    verification: buildStakeEvents(device?.staked),
    registration: buildStakeEvents(device?.registration),
    node: buildStakeEvents(device?.node)
  };
}

const __private__ = {
  toISOString,
  toFiniteNumber
};

module.exports = {
  buildStakeEvents,
  collectStakeHistory,
  __private__
};
