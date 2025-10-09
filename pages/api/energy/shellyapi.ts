import fetch from 'node-fetch';

export type ShellyAllDevicesResponse = {
  success?: boolean;
  isok?: boolean;
  data?: {
    devices_status?: Record<string, any>;
  };
  msg?: string;
};

export default class ShellyApi {
  host: string;
  token: string;
  timeout: number;

  constructor(host: string, token: string, timeout = 5000) {
    if (!host || typeof host !== 'string') throw new Error('host must be specified');
    if (!token || typeof token !== 'string') throw new Error('token must be specified');
    this.host = host.replace(/\/$/, '');
    this.token = token;
    this.timeout = timeout;
  }

  private async post(path: string, body: Record<string, any>): Promise<any> {
    const url = `${this.host}/device/${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);
    try {
      const res = await fetch(url, {
        method: 'POST',
        body: new URLSearchParams(body as any),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const json = await res.json().catch(() => null);
      return json;
    } catch (err) {
      clearTimeout(timer);
      throw err;
    }
  }

  async get_all_devices(): Promise<ShellyAllDevicesResponse> {
    const payload = { auth_key: this.token };
    const r = await this.post('all_status', payload);
    return r as ShellyAllDevicesResponse;
  }

  async get_active_device_ids(): Promise<string[]> {
    const resp = await this.get_all_devices();

    // Older API may use success=true or isok=true
    if (!resp || (resp.success === false) || (resp.isok === false)) {
      throw new Error(`Request failed with: ${JSON.stringify(resp)}`);
    }

    const devices = resp?.data?.devices_status ?? {};
    const active: string[] = [];

    for (const [deviceId, deviceData] of Object.entries(devices)) {
      try {
        const cloudInfo = (deviceData as any)?.cloud ?? {};
        if (cloudInfo?.connected) {
          active.push(deviceId);
        }
      } catch (e) {
        // ignore malformed entries
      }
    }

    return active;
  }
}
