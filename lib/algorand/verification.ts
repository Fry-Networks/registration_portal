export enum VERIFY_RESULT {
  OK,
  INTERNAL_ERROR,
  FAILED
}

export interface VerifyTransactionRequest {
  address: string;
  txId: string;
}

export async function verifyTransactionRequest({
  address,
  txId
}: VerifyTransactionRequest): Promise<VERIFY_RESULT> {
  try {
    const response = await fetch('/api/algorand/verify-txn', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ address, txId })
    });

    if (!response.ok) {
      return VERIFY_RESULT.INTERNAL_ERROR;
    }

    const result = await response.json().catch(() => ({}));
    return result?.success ? VERIFY_RESULT.OK : VERIFY_RESULT.FAILED;
  } catch (error) {
    console.error('[verifyTransactionRequest] failed', error);
    return VERIFY_RESULT.INTERNAL_ERROR;
  }
}
