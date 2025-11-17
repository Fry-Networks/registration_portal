import { notifyDiscordError } from '../discord-webhook';
import { waitForFinalConfirmation } from '../wallet/transactionConfirmation';

export interface TransactionMonitorContext {
  minerKey: string;
  walletAddress: string;
  operation: string;
  amount?: number;
  assetId?: string | number;
  preconfirmed?: boolean;
  confirmedRound?: number;
}

export async function monitorTransaction(
  txId: string,
  context: TransactionMonitorContext
): Promise<void> {
  if (context.preconfirmed) {
    await notifyDiscordError({
      minerKey: context.minerKey,
      walletAddress: context.walletAddress,
      issueType: 'TRANSACTION_CONFIRMED',
      part: context.operation,
      errorMessage: `✅ ${context.operation} confirmed`,
      severity: 'success',
      metadata: {
        txId,
        amount: context.amount,
        assetId: context.assetId,
        confirmedRound: context.confirmedRound
      }
    });
    return;
  }

  try {
    const confirmation = await waitForFinalConfirmation(txId, {
      minConfirmations: 1,
      maxRoundWait: 120
    });

    await notifyDiscordError({
      minerKey: context.minerKey,
      walletAddress: context.walletAddress,
      issueType: 'TRANSACTION_CONFIRMED',
      part: context.operation,
      errorMessage: `✅ ${context.operation} confirmed in round ${confirmation.confirmedRound}`,
      severity: 'success',
      metadata: {
        txId,
        amount: context.amount,
        assetId: context.assetId,
        confirmedRound: confirmation.confirmedRound,
        confirmationRounds: confirmation.confirmationRounds
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    await notifyDiscordError({
      minerKey: context.minerKey,
      walletAddress: context.walletAddress,
      issueType: 'TRANSACTION_TIMEOUT',
      part: context.operation,
      errorMessage: `⚠️ ${context.operation} not confirmed (monitor error: ${message})`,
      severity: 'warning',
      metadata: {
        txId,
        amount: context.amount,
        assetId: context.assetId
      }
    });
  }
}
