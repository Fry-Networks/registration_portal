import type { NextApiRequest, NextApiResponse } from 'next';

import { getServerSession } from 'next-auth';

import { authOptions } from '../auth/[...nextauth]';

import clientPromise from '../../../lib/mongoclient';
import { ObjectId } from 'mongodb';
import { loggers } from '../../../lib/logger';
import {
  CommonErrors,
  createApiError,
  ErrorCodes,
  handleApiError,
} from '../../../lib/api-errors';
import type { ApiErrorResponse } from '../../../lib/api-errors';

type TempestRequestBody = {
  miner_key?: string | string[];

  stationID?: string;

  token?: string;

  address?: string;
};

type TempestSuccessResponse = {
  message: string;

  status: 'SUCCESS';
};

type TempestApiResponse = TempestSuccessResponse | ApiErrorResponse;

type StationShape = {
  station_id?: unknown;

  station_name?: unknown;

  name?: unknown;

  latitude?: unknown;

  longitude?: unknown;

  lat?: unknown;

  lon?: unknown;
};

type TempestPayload = {
  station_id?: unknown;

  station_name?: unknown;

  name?: unknown;

  latitude?: unknown;

  longitude?: unknown;

  lat?: unknown;

  lon?: unknown;

  station?: StationShape;
};

const TEMPEST_API_BASE =
  'https://swd.weatherflow.com/swd/rest/observations/station';

const WEATHER_DB_NAME = process.env.MONGO_CREDS_DB ?? 'creds';

const WEATHER_COLLECTION =
  process.env.MONGO_WEATHER_COLLECTION ??
  (process.env.NEXT_PUBLIC_TEST_MODE === 'true' ? 'test-weather' : 'weather');

const normalizeString = (value: unknown): string | undefined => {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value) && typeof value[0] === 'string') {
    return value[0];
  }

  return undefined;
};

const normalizeNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
};

const extractStationDetails = (payload: TempestPayload) => {
  const station =
    typeof payload.station === 'object' && payload.station !== null
      ? payload.station
      : undefined;

  const stationId =
    normalizeNumber(payload.station_id) ?? normalizeNumber(station?.station_id);

  const name =
    normalizeString(payload.station_name) ??
    normalizeString(station?.station_name) ??
    normalizeString(payload.name) ??
    normalizeString(station?.name);

  const latitude =
    normalizeNumber(payload.latitude) ??
    normalizeNumber(station?.latitude) ??
    normalizeNumber((payload as Record<string, unknown>).lat) ??
    normalizeNumber(station?.lat);

  const longitude =
    normalizeNumber(payload.longitude) ??
    normalizeNumber(station?.longitude) ??
    normalizeNumber((payload as Record<string, unknown>).lon) ??
    normalizeNumber(station?.lon);

  return { stationId, name, latitude, longitude };
};

const fetchTempestObservations = async (
  stationId: string,

  token: string
): Promise<TempestPayload> => {
  const url = `${TEMPEST_API_BASE}/${encodeURIComponent(stationId)}?token=${encodeURIComponent(token)}`;

  const response = await fetch(url, { method: 'GET' });

  const payload = (await response.json().catch(() => ({}))) as TempestPayload;

  if (!response.ok || !payload) {
    throw new Error('Failed to contact Tempest service.');
  }

  const status = (payload as Record<string, unknown>).status as
    | { status_code?: number; status_message?: string }
    | undefined;

  if (!status || status.status_code !== 0) {
    const message =
      status?.status_message ??
      'Tempest API rejected the provided credentials.';

    const error = new Error(message);

    (error as Error & { statusCode?: number }).statusCode = 400;

    throw error;
  }

  return payload;
};

export default async function handler(
  req: NextApiRequest,

  res: NextApiResponse<TempestApiResponse>
) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);

    res.status(405).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'That request is not available.',
        'Please retry this action from the dashboard.'
      )
    );

    return;
  }

  const session = await getServerSession(req, res, authOptions);

  if (!session || !session.user?.address) {
    return res.status(401).json(CommonErrors.noSession());
  }

  const body = (req.body as TempestRequestBody) ?? {};

  const minerKey = normalizeString(body.miner_key);

  const stationIdInput = normalizeString(body.stationID);

  const token = normalizeString(body.token);

  const address = normalizeString(body.address);

  if (!minerKey || !stationIdInput || !token || !address) {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Missing required fields',
        'Provide miner key, Tempest station ID, token, and address.'
      )
    );
    return;
  }

  if (address !== session.user.address) {
    loggers.apiError('/api/weather/tempest', new Error('Wallet mismatch during Tempest credential save'), {
      sessionAddress: session.user.address,
      address,
      miner_key: minerKey,
      issueType: 'TEMPEST_WALLET_MISMATCH',
      part: 'weather.tempest.auth',
    });
    res.status(401).json(CommonErrors.walletMismatch());
    return;
  }

  const stationNumeric = normalizeNumber(stationIdInput);

  if (stationNumeric === undefined) {
    res.status(400).json(
      createApiError(
        ErrorCodes.INVALID_INPUT,
        'Invalid station ID',
        'Ensure the Tempest station ID is numeric.'
      )
    );
    return;
  }

  try {
    const payload = await fetchTempestObservations(stationIdInput, token);

    const { stationId, name, latitude, longitude } =
      extractStationDetails(payload);

    const client = await clientPromise;

    const db = client.db(WEATHER_DB_NAME);

    const collection = db.collection(WEATHER_COLLECTION);

    const now = new Date();

    const minerSubtype = minerKey.includes('-')
      ? minerKey.split('-')[0]
      : minerKey;

    const stationIdentifier = stationId ?? stationNumeric;

    if (stationIdentifier === undefined) {
      const error = new Error('Failed to resolve Tempest station identifier.');
      (error as Error & { statusCode?: number }).statusCode = 500;
      throw error;
    }

    const existingCredential = await collection.findOne<{
      owner_address?: string;
      miner_key?: string;
    }>({
      api_type: 'tempest',

      stationID: stationIdentifier
    });

    if (
      existingCredential &&
      existingCredential.owner_address &&
      existingCredential.owner_address !== session.user.address
    ) {
      res.status(409).json(
        createApiError(
          ErrorCodes.DEVICE_OWNER_MISMATCH,
          'This Tempest station is already registered by another user.',
          'Unlink the station from the other account or contact support for assistance.'
        )
      );
      return;
    }

    const userObjectId =
      typeof session.user.id === 'string' && ObjectId.isValid(session.user.id)
        ? new ObjectId(session.user.id)
        : undefined;

    const document = {
      miner_key: minerKey,

      user_id:
        userObjectId ??
        (typeof session.user.id === 'string'
          ? session.user.id
          : session.user.address),

      timestamp: now,

      miner_type: 'weather',

      miner_subtype: minerSubtype,

      api_type: 'tempest',

      stationID: stationIdentifier,

      token,

      lat: latitude,

      lon: longitude,

      device_name: name ?? `Tempest Station ${stationNumeric}`,

      owner_address: session.user.address
    };

    await collection.updateOne(
      { miner_key: minerKey, api_type: 'tempest' },

      { $set: document },

      { upsert: true }
    );

    const testMode = process.env.NEXT_PUBLIC_TEST_MODE === 'true';

    const devicesCollection = client

      .db('main')

      .collection(testMode ? 'test-devices' : 'devices');

    const deviceRecord = await devicesCollection.findOne<{ address?: string }>({
      miner_key: minerKey
    });

    if (
      deviceRecord?.address &&
      deviceRecord.address !== session.user.address
    ) {
      res.status(403).json(
        createApiError(
          ErrorCodes.DEVICE_OWNER_MISMATCH,
          'Device is registered to another address.',
          'Sign in with the wallet that owns this device or ask support to unlink it first.'
        )
      );

      return;
    }

    await devicesCollection.updateOne(
      { miner_key: minerKey },

      {
        $set: { registered_portal_model: 'tempest' },

        $currentDate: { updated_at: true }
      }
    );

    res

      .status(200)

      .json({
        message: 'Tempest credentials validated and saved.',

        status: 'SUCCESS'
      });
  } catch (error) {
    const statusCode =
      error instanceof Error &&
      'statusCode' in error &&
      typeof (error as Error & { statusCode?: number }).statusCode === 'number'
        ? (error as Error & { statusCode?: number }).statusCode
        : 500;

    handleApiError(res, '/api/weather/tempest', error, {
      status: statusCode,
      response: createApiError(
        ErrorCodes.INTERNAL_ERROR,
        'Failed to submit Tempest credentials',
        'Please try again. If the problem persists, contact support.'
      ),
      minerKey,
      walletAddress: session.user.address,
      issueType: 'TEMPEST_SUBMISSION_ERROR',
      part: 'weather.tempest.handler',
      metadata: {
        miner_key: minerKey,
        stationID: stationIdInput,
        address,
      },
    });
  }
}
