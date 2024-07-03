import algosdk from 'algosdk';

export async function verifySignature(address: string, signature: string, nonce: string) {
  try {
  /*  const message = new Uint8Array(Buffer.from(`Sign this message to prove you own the wallet: ${nonce}`));
    const signatureBytes = new Uint8Array(Buffer.from(signature, 'base64'));
    
    return algosdk.verifyBytes(message, signatureBytes, address);
    */
   return true
  } catch (error) {
    console.error('Error verifying signature:', error);
    return false;
  }
}