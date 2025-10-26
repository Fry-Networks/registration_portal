import type { NextApiRequest, NextApiResponse } from 'next';
import { getServerSession } from 'next-auth';
import { authOptions } from '../auth/[...nextauth]';
import clientPromise from '../../../lib/mongoclient';
import { loggers } from '../../../lib/logger';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../../lib/api-errors';
import type { ApiErrorResponse } from '../../../lib/api-errors';

type CredentialRequestBody = {
  miner_key?: string | string[];
  type?: string;
};

type CredentialRecord = {
  miner_key: string;
  api_type: string;
  stationID?: number;
  token?: string;
  secret?: string;
  auth_key?: string;
  server_url?: string;
  lat?: number;
  lon?: number;
  device_name?: string;
  deviceId?: string;
  device_type?: string;
  hub_device_id?: string;
  timestamp?: Date;
  updated_at?: Date;
  owner_address?: string;
};

type CredentialSuccessResponse = {
  data: {
    miner_key: string;
    api_type: string;
    stationID?: number;
    token?: string;
    secret?: string;
    auth_key?: string;
    server_url?: string;
    lat?: number;
    lon?: number;
    device_name?: string;
    deviceId?: string;
    device_type?: string;
    hub_device_id?: string;
    timestamp?: Date;
  } | null;
};

type CredentialErrorResponse = ApiErrorResponse & {
  status: 'ERROR';
};

type CredentialApiResponse =
  | CredentialSuccessResponse
  | CredentialErrorResponse;

const normalizeString = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }

  return undefined;
};

const WEATHER_DB_NAME = process.env.MONGO_CREDS_DB ?? 'creds';
const WEATHER_COLLECTION =
  process.env.MONGO_WEATHER_COLLECTION ??
  (process.env.NEXT_PUBLIC_TEST_MODE === 'true' ? 'test-weather' : 'weather');
const DEFAULT_API_TYPE = 'tempest';
const ENERGY_COLLECTION =
  process.env.MONGO_ENERGY_COLLECTION ??
  (process.env.NEXT_PUBLIC_TEST_MODE === 'true' ? 'test-energy' : 'energy');

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CredentialApiResponse>
) {
  const makeErrorResponse = (payload: ApiErrorResponse): CredentialErrorResponse => ({
    ...payload,
    status: 'ERROR',
  });

  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    res.status(405).json(
      makeErrorResponse(
        createApiError(
          ErrorCodes.INVALID_INPUT,
          'That request is not available.',
          'Please retry this action from the dashboard.'
        )
      )
    );
    return;
  }

  const session = await getServerSession(req, res, authOptions);

  if (!session || !session.user?.address) {
    res.status(401).json(makeErrorResponse(CommonErrors.noSession()));
    return;
  }

  const body = (req.body as CredentialRequestBody) ?? {};
  const minerKey = normalizeString(body.miner_key);
  const apiType = normalizeString(body.type) ?? DEFAULT_API_TYPE;

  if (!minerKey) {
    res.status(400).json(
      makeErrorResponse(
        createApiError(
          ErrorCodes.INVALID_INPUT,
          'Miner key is required',
          'Submit the miner key to fetch credential details.'
        )
      )
    );
    return;
  }

  try {
    const client = await clientPromise;
    const db = client.db(WEATHER_DB_NAME);
    const isEnergyCredential = apiType === 'switchbot' || apiType === 'shelly';
    const collection = db.collection(
      isEnergyCredential ? ENERGY_COLLECTION : WEATHER_COLLECTION
    );

    const record = await collection.findOne<
      CredentialRecord & { owner_address?: string }
    >({ miner_key: minerKey, api_type: apiType });

    if (
      record &&
      record.owner_address &&
      record.owner_address !== session.user.address
    ) {
      res.status(403).json(makeErrorResponse(CommonErrors.deviceOwnerMismatch()));
      return;
    }

    const sanitized = record
      ? {
          miner_key: record.miner_key,
          api_type: record.api_type,
          stationID: record.stationID,
          token: record.token,
          secret: record.secret,
          auth_key: record.auth_key,
          server_url: record.server_url,
          lat: record.lat,
          lon: record.lon,
          device_name: record.device_name,
          deviceId: record.deviceId,
          device_type: record.device_type,
          hub_device_id: record.hub_device_id,
          timestamp: record.timestamp ?? record.updated_at
        }
      : null;

    res.status(200).json({ data: sanitized });
  } catch (error) {
    handleApiError(res, '/api/devices/get-credential', error, {
      response: makeErrorResponse(
        createApiError(
          ErrorCodes.INTERNAL_ERROR,
          'Failed to load device credential',
          'Please try again. If the problem persists, contact support.'
        )
      ),
      minerKey: minerKey,
      walletAddress: session.user.address,
      issueType: 'DEVICE_CREDENTIAL_FETCH_ERROR',
      part: 'devices.get-credential.handler',
      metadata: {
        miner_key: minerKey,
        api_type: apiType,
      },
    });
  }
}
