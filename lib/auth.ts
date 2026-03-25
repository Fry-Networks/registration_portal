import algosdk from 'algosdk';
import nacl from 'tweetnacl';
import { getSigningAddress } from './algorand/authAddr';

export async function verifySignature(
  address: string,
  signedTxnBase64: string,
  nonce: string
): Promise<boolean> {
  try {
    const message = `Sign this message to prove you own the wallet: ${nonce}`;

    // === DEBUG LOGGING START ===
    console.log('[AUTH DEBUG] Received signedTxnBase64:', {
      type: typeof signedTxnBase64,
      length: signedTxnBase64?.length ?? 'undefined',
      startsWithBase64Chars: /^[A-Za-z0-9+/]/.test(signedTxnBase64 || ''),
      first20Chars: signedTxnBase64?.substring(0, 20) + '...',
      last10Chars: '...' + signedTxnBase64?.substring((signedTxnBase64?.length ?? 0) - 10),
    });

    let rawSignedTxn: Uint8Array;
    try {
      rawSignedTxn = new Uint8Array(Buffer.from(signedTxnBase64, 'base64'));
      console.log('[AUTH DEBUG] Decoded Uint8Array:', {
        byteLength: rawSignedTxn.byteLength,
        firstBytes: Array.from(rawSignedTxn.slice(0, 10)).map(b => b.toString(16).padStart(2, '0')).join(' '),
      });
    } catch (decodeErr) {
      console.error('[AUTH DEBUG] Base64 decode failed:', decodeErr);
      throw decodeErr;
    }

    let stxn;
    try {
      stxn = algosdk.decodeSignedTransaction(rawSignedTxn);
      console.log('[AUTH DEBUG] decodeSignedTransaction succeeded');
    } catch (stxnErr) {
      console.error('[AUTH DEBUG] decodeSignedTransaction FAILED:', {
        error: stxnErr,
        rawByteLength: rawSignedTxn.byteLength,
        looksLikeRawSignature: rawSignedTxn.byteLength === 64,
        looksLikeSignedTxn: rawSignedTxn.byteLength > 100,
      });
      throw stxnErr;
    }
    // === DEBUG LOGGING END ===

    if (!stxn || !stxn.sig) return false;

    // 2) Produce the canonical bytes the wallet actually signed:
    //    msg = "TX" || msgpack(UnsignedTxnForSigning)
    //    Ensure we do NOT encode a raw object that includes zero/empty fields.
    // In algosdk v3, decodeSignedTransaction returns a Transaction instance.
    // We can directly encode the unsigned bytes from it.
    const unsignedBytes = algosdk.encodeUnsignedTransaction(stxn.txn);
    const msgBytes = new Uint8Array(unsignedBytes.length + 2);
    msgBytes.set(Buffer.from('TX'));
    msgBytes.set(unsignedBytes, 2);

    // 3) Get the signing address (auth-addr for rekeyed accounts, address for normal)
    //    This supports rekeyed accounts where the signature comes from the auth-addr's key
    const signingAddress = await getSigningAddress(address);
    const pkBytes = algosdk.decodeAddress(signingAddress).publicKey;
    const sigBytes = new Uint8Array(stxn.sig);
    let valid = nacl.sign.detached.verify(msgBytes, sigBytes, pkBytes);

    // If verification failed, try with fresh auth-addr lookup (handles mid-session rekey)
    if (!valid) {
      const freshSigningAddress = await getSigningAddress(address, true);
      if (freshSigningAddress !== signingAddress) {
        const freshPkBytes = algosdk.decodeAddress(freshSigningAddress).publicKey;
        valid = nacl.sign.detached.verify(msgBytes, sigBytes, freshPkBytes);
      }
    }

    if (!valid) return false;

    // 4) Check the note field matches our message
    const rawNote = (stxn.txn as any).note as Uint8Array | undefined;
    const txnNote = rawNote ? Buffer.from(rawNote).toString() : '';
    if (txnNote !== message) {
      console.error('Transaction note does not match the expected message.');
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error verifying signature:', error);
    return false;
  }
}
