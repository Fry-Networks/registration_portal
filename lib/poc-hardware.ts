import clientPromise from './mongoclient';

/**
 * Upsert a PoC.hardware document for a device.
 * Lightweight write — sets only registration-level fields.
 * Heavy fields (PoC/PoD/PoL scores, rewards, software) are owned by the backend pipeline.
 */
export async function upsertPocHardware(
  minerKey: string,
  options: { tool?: string; mac?: string } = {}
): Promise<void> {
  try {
    const client = await clientPromise;
    const pocHardware = client.db('PoC').collection('hardware');
    const minerType = minerKey.split('-')[0];
    const now = new Date().toISOString();

    const update: Record<string, any> = {
      $set: { miner_type: minerType, lastUpdated: now },
      $setOnInsert: { miner_key: minerKey, day: now.split('T')[0] },
    };

    if (options.tool) {
      update.$addToSet = { registered_tools: options.tool };
    }

    if (options.mac) {
      update.$set['mac.evidence.registered_mac'] = options.mac;
      update.$set['mac.last_checked_at'] = now;
    }

    await pocHardware.updateOne({ miner_key: minerKey }, update, { upsert: true });
  } catch (err) {
    console.error(`[poc-hardware] upsert failed for ${minerKey}:`, err);
  }
}
