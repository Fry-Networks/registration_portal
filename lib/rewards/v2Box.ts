import algosdk, { Algodv2, decodeAddress } from 'algosdk';

export const V2_APP_ID = 3633170823;
export const V2_APP_ADDR = 'BKHQSNOUJMRZOZCG6AU5FKM67BD32XXZF2SSZV2GMYGNFCT7EUOQKK55YI';
export const V2_FEE_ADDRESS = 'U5TA6XANQ7G3XTKTBP5VEUXHSHZO2GWMZN75OU3BIHTQ5D7LDXZA7ATXSI';

export interface V2TokenState {
  entitled: bigint;
  matured: bigint;
  claimed: bigint;
}
export interface V2WalletState {
  tokens: Record<number, V2TokenState>;
}

const BOX_PREFIX = new Uint8Array([0x77, 0x73]); // "ws"

export function v2BoxName(wallet: string): Uint8Array {
  const pk = decodeAddress(wallet).publicKey;
  const name = new Uint8Array(2 + pk.length);
  name.set(BOX_PREFIX, 0);
  name.set(pk, 2);
  return name;
}

export async function readV2Box(
  algod: Algodv2,
  wallet: string,
  tokenCount: number
): Promise<V2WalletState | null> {
  try {
    const res = await algod.getApplicationBoxByName(V2_APP_ID, v2BoxName(wallet)).do();
    const data = new Uint8Array(res.value);
    if (data.length !== 192) return null;

    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const tokens: Record<number, V2TokenState> = {};
    for (let i = 0; i < tokenCount; i++) {
      const off = i * 24;
      tokens[i] = {
        entitled: view.getBigUint64(off, false),
        matured: view.getBigUint64(off + 8, false),
        claimed: view.getBigUint64(off + 16, false),
      };
    }
    return { tokens };
  } catch {
    return null;
  }
}

export interface TokenInfo {
  index: number;
  asaId: number;
  name: string;
  active: boolean;
}

export async function readV2TokenRegistry(algod: Algodv2): Promise<TokenInfo[]> {
  const app = await algod.getApplicationByID(V2_APP_ID).do();
  const gs = new Map<string, any>();
  for (const kv of app.params.globalState ?? []) {
    const keyStr = typeof kv.key === 'string' ? kv.key : Buffer.from(kv.key as Uint8Array).toString('base64');
    const k = Buffer.from(keyStr, 'base64').toString();
    const val = kv.value.type === 2
      ? Number(kv.value.uint)
      : typeof kv.value.bytes === 'string'
        ? Buffer.from(kv.value.bytes, 'base64')
        : Buffer.from(kv.value.bytes ?? new Uint8Array());
    gs.set(k, val);
  }
  const count = (gs.get('token_count') as number) ?? 0;
  const names = ['tFRY', 'fNODE', 'FRY 3.0', 'slot 3', 'slot 4', 'slot 5', 'slot 6', 'slot 7'];
  const res: TokenInfo[] = [];
  for (let i = 0; i < count; i++) {
    const asaId = (gs.get(`token_${i}`) as number) ?? 0;
    if (asaId === 0) continue;
    res.push({ index: i, asaId, name: names[i], active: true });
  }
  return res;
}
