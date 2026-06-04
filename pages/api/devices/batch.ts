import type { NextApiRequest, NextApiResponse } from "next";
import { getServerSession } from "next-auth";
import { authOptions } from "../auth/[...nextauth]";
import clientPromise from "../../../lib/mongoclient";
import { hydrateDeviceWithPosition } from "../../../lib/devicePosition";
import { shouldForceLegacyUnverified } from "../../../lib/legacyStake";
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from "../../../lib/api-errors";
import type { Collection, Document, ObjectId } from "mongodb";
import type { Device } from "../../../lib/types";
import { enrichLegacyStakeData } from "./[miner_key]";

const MAX_BATCH_SIZE = 200;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const session = await getServerSession(req, res, authOptions);
  if (!session || !session.user) {
    return res.status(401).json(CommonErrors.noSession());
  }

  const walletAddress = session.user.address;
  const { miner_keys } = req.body ?? {};

  if (!Array.isArray(miner_keys) || miner_keys.length === 0) {
    return res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        "Invalid or missing miner_keys array",
        "Please provide an array of miner keys."
      )
    );
  }

  const uniqueKeys = Array.from(new Set(miner_keys.filter((k: unknown) => typeof k === "string" && k.length > 0)));
  if (uniqueKeys.length > MAX_BATCH_SIZE) {
    return res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        `Batch size ${uniqueKeys.length} exceeds maximum of ${MAX_BATCH_SIZE}`,
        "Please reduce the number of miner keys."
      )
    );
  }

  try {
    const testMode =
      process.env.NEXT_PUBLIC_TEST_MODE === "true";
    const client = await clientPromise;
    const db = client.db("main");
    const collection: Collection<Document> = db.collection(
      testMode ? "test-devices" : "devices"
    );

    const cursor = collection.find<{ _id: ObjectId } & Device>({
      miner_key: { $in: uniqueKeys },
      address: walletAddress,
    });
    const rawDevices = await cursor.toArray();

    const devices: Record<string, Device> = {};

    for (const rawDevice of rawDevices) {
      if (shouldForceLegacyUnverified(rawDevice) && rawDevice.verified) {
        await collection.updateOne(
          { _id: rawDevice._id },
          { $set: { verified: false } }
        );
        rawDevice.verified = false;
      }

      const hydrated = await hydrateDeviceWithPosition(client, rawDevice as any);
      await enrichLegacyStakeData(collection, rawDevice.miner_key, hydrated);
      devices[rawDevice.miner_key] = hydrated;
    }


    // Compute is_active for tracked device prefixes (14-day poc_reward_dailies lookback)
    const TRACKED_PREFIXES = ['AEM', 'BM', 'RDN', 'SDN', 'SVN', 'CN'];
    const trackedKeys = Object.keys(devices).filter(k => TRACKED_PREFIXES.includes(k.split('-')[0]));
    if (trackedKeys.length > 0) {
      const cutoff = new Date(Date.now() - 14 * 86400000);
      const activeKeys: string[] = await db.collection('poc_reward_dailies')
        .distinct('miner_key', { miner_key: { $in: trackedKeys }, date: { $gte: cutoff } });
      const activeSet = new Set(activeKeys);
      for (const key of trackedKeys) {
        (devices[key] as any).is_active = activeSet.has(key);
      }
    }

    return res.status(200).json({ success: true, devices });
  } catch (error) {
    handleApiError(res, "/api/devices/batch", error, {
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        "Unable to load batch device information",
        "Please try again. If the problem persists, contact support."
      ),
      walletAddress,
      issueType: "BATCH_DEVICE_FETCH_ERROR",
      part: "devices.batch.handler",
      metadata: { keyCount: uniqueKeys.length },
    });
  }
}
