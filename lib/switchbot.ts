import crypto from 'crypto';

export const SWITCHBOT_BASE_URL = 'https://api.switch-bot.com';
export const MIN_TOKEN_LENGTH = 96;
export const MIN_SECRET_LENGTH = 32;

export type SwitchbotDeviceRecord = {
  deviceId?: unknown;
  deviceName?: unknown;
  deviceType?: unknown;
  hubDeviceId?: unknown;
};

export type SwitchbotDeviceListBody = {
  deviceList?: SwitchbotDeviceRecord[];
};

export type SwitchbotStatusBody = {
  deviceId?: string;
  deviceType?: string;
  hubDeviceId?: string;
};

export type SwitchbotBaseResponse<TBody> = {
  statusCode?: number;
  message?: string;
  body?: TBody;
};

export const sanitizeDeviceId = (value: string) =>
  value.replace(/[^0-9a-fA-F]/g, '').toUpperCase();

export class SwitchbotClient {
  private readonly token: string;
  private readonly secret: string;
  private readonly timeout: number;

  constructor(token: string, secret: string, timeout = 10000) {
    this.token = token;
    this.secret = secret;
    this.timeout = timeout;
  }

  private buildHeaders() {
    const timestamp = Date.now().toString();
    const nonce = crypto.randomUUID();
    const signature = crypto
      .createHmac('sha256', this.secret)
      .update(this.token + timestamp + nonce)
      .digest('base64');

    return {
      Authorization: this.token,
      sign: signature,
      t: timestamp,
      nonce,
      'Content-Type': 'application/json'
    };
  }

  private async request<TBody>(path: string) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    try {
      const response = await fetch(`${SWITCHBOT_BASE_URL}${path}`, {
        method: 'GET',
        headers: this.buildHeaders(),
        signal: controller.signal
      });

      const payload = (await response
        .json()
        .catch(() => ({}))) as SwitchbotBaseResponse<TBody>;

      if (!response.ok) {
        const message =
          payload?.message ?? `SwitchBot request failed with ${response.status}`;
        const error = new Error(message);
        (error as Error & { statusCode?: number }).statusCode = response.status;
        throw error;
      }

      return payload;
    } catch (error) {
      if (
        error instanceof Error &&
        ('name' in error ? (error as Error & { name?: string }).name : undefined) ===
          'AbortError'
      ) {
        const timeoutError = new Error('SwitchBot request timed out.');
        (timeoutError as Error & { statusCode?: number }).statusCode = 504;
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async listDevices() {
    return this.request<SwitchbotDeviceListBody>('/v1.1/devices');
  }

  async getDeviceStatus(deviceId: string) {
    return this.request<SwitchbotStatusBody>(`/v1.1/devices/${deviceId}/status`);
  }
}
