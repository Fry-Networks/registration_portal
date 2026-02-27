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

    // 1) Decode the signed txn
    const rawSignedTxn = new Uint8Array(Buffer.from(signedTxnBase64, 'base64'));
    const stxn = algosdk.decodeSignedTransaction(rawSignedTxn);
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
