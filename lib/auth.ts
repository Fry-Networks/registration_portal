import algosdk from 'algosdk';
import nacl from 'tweetnacl';

export async function verifySignature(address: string, signedTxnBase64: string, nonce: string): Promise<boolean> {
  try {
    const message = `Sign this message to prove you own the wallet: ${nonce}`;

    // Decode the signed transaction from base64
    const rawSignedTxn = new Uint8Array(Buffer.from(signedTxnBase64, 'base64'));
    const stxn = algosdk.decodeSignedTransaction(rawSignedTxn);
    if (stxn.sig === undefined) return false;

    // Get the txn object
    const txnObj = stxn.txn.get_obj_for_encoding();
    if (txnObj === undefined) return false;

    // Encode as msgpack
    const txnBytes = algosdk.encodeObj(txnObj);
    // Create byte array with TX prefix
    const msgBytes = new Uint8Array(txnBytes.length + 2);
    msgBytes.set(Buffer.from('TX'));
    msgBytes.set(txnBytes, 2);

    // Grab the other things we need to verify
    const pkBytes = stxn.txn.from.publicKey;
    const sigBytes = new Uint8Array(stxn.sig);

    // Verify the signature
    const valid = nacl.sign.detached.verify(msgBytes, sigBytes, pkBytes);
    console.log('Signature valid:', valid);

    // Check the note field
    const txnNote = Buffer.from(stxn.txn.note as Uint8Array).toString();
    if (txnNote !== message) {
      console.error('Transaction note does not match the expected message.');
      return false;
    }

    return valid;
  } catch (error) {
    console.error('Error verifying signature:', error);
    return false;
  }
}
