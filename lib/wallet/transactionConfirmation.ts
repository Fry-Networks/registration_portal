import algosdk from 'algosdk';
import { getAlgodClient } from './clients';
import type { SupportedNetwork } from './config';

export interface TransactionConfirmationOptions {
  minConfirmations?: number;
  maxRoundWait?: number;
  network?: SupportedNetwork;
}

export interface TransactionConfirmation {
  confirmedRound: number;
  confirmationRounds: number;
  performedWaitRounds: number;
}

export async function waitForFinalConfirmation(
  txId: string,
  { minConfirmations = 4, maxRoundWait = 20, network }: TransactionConfirmationOptions = {}
): Promise<TransactionConfirmation> {
  const algod = getAlgodClient(network);
  const confirmedTxn = await algosdk.waitForConfirmation(algod, txId, maxRoundWait);
  const confirmedRound = confirmedTxn['confirmed-round'];

  if (!confirmedRound) {
    throw new Error(`Transaction ${txId} was not confirmed within ${maxRoundWait} rounds.`);
  }

  let performedWaitRounds = 0;

  const status = await algod.status().do();
  let currentRound = status['last-round'];
  let depth = currentRound - confirmedRound;

  while (depth < minConfirmations) {
    currentRound += 1;
    await algod.statusAfterBlock(currentRound).do();
    performedWaitRounds += 1;
    const updatedStatus = await algod.status().do();
    depth = updatedStatus['last-round'] - confirmedRound;
  }

  return {
    confirmedRound,
    confirmationRounds: depth,
    performedWaitRounds
  };
}
