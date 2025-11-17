import { useCallback, useState } from 'react';
import { useToastContext } from '../../hooks/ToastContext';

export interface RetryStrategy {
  maxAttempts: number;
  delays: number[];
  messages: string[];
  shouldRetry: (error: Error) => boolean;
}

const RETRY_STRATEGIES = {
  wallet_signing: {
    maxAttempts: 3,
    delays: [0, 2000, 5000],
    messages: [
      'Preparing transaction...',
      'Waiting for wallet response...',
      'Final attempt with extended timeout...'
    ],
    shouldRetry: (error: Error) => !error.message.toLowerCase().includes('cancel')
  },
  network_operation: {
    maxAttempts: 4,
    delays: [0, 1000, 3000, 8000],
    messages: [
      'Submitting to blockchain...',
      'Network congestion detected, retrying...',
      'Using backup node...',
      'Final network attempt...'
    ],
    shouldRetry: (error: Error) =>
      error.message.toLowerCase().includes('network') ||
      error.message.toLowerCase().includes('timeout')
  }
} as const;

export interface RetryState {
  attempt: number;
  isRetrying: boolean;
  lastError: Error | null;
}

type StrategyKey = keyof typeof RETRY_STRATEGIES;

interface RetryContext {
  operationType?: string;
  amount?: number;
}

interface ErrorGuidance {
  title: string;
  message: string;
  action?: { label: string; handler: () => void };
}

export function useSmartRetry(strategyType: StrategyKey) {
  const toast = useToastContext();
  const [retryState, setRetryState] = useState<RetryState>({
    attempt: 0,
    isRetrying: false,
    lastError: null
  });

  const strategy = RETRY_STRATEGIES[strategyType];

  const executeWithRetry = useCallback(
    async <T>(operation: () => Promise<T>, context?: RetryContext): Promise<T> => {
      setRetryState({ attempt: 0, isRetrying: false, lastError: null });

      for (let attempt = 0; attempt < strategy.maxAttempts; attempt++) {
        try {
          if (attempt > 0) {
            setRetryState({ attempt, isRetrying: true, lastError: retryState.lastError });
            toast.info({
              heading: `Retry ${attempt}/${strategy.maxAttempts - 1}`,
              message: strategy.messages[attempt] || 'Retrying operation...'
            });

            const delay = strategy.delays[attempt] ?? 1000;
            await new Promise((resolve) => setTimeout(resolve, delay));
          }

          const result = await operation();

          if (attempt > 0) {
            toast.success({
              heading: 'Success',
              message: `Completed after ${attempt + 1} attempts`
            });
          }

          return result;
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          setRetryState({ attempt, isRetrying: false, lastError: err });
          const shouldRetry =
            strategy.shouldRetry(err) && attempt < strategy.maxAttempts - 1;

          if (!shouldRetry) {
            const guidance = getErrorGuidance(err, context);
            toast.error({
              heading: guidance.title,
              message: guidance.message
            });
            throw err;
          }
        }
      }

      throw new Error('All retry attempts failed');
    },
    [strategy, retryState.lastError, toast]
  );

  return { executeWithRetry, retryState };
}

function getErrorGuidance(error: Error, context?: RetryContext): ErrorGuidance {
  const errorMsg = error.message.toLowerCase();

  if (errorMsg.includes('cancel')) {
    return {
      title: 'Transaction Cancelled',
      message: 'You cancelled the transaction in your wallet. You can retry when ready.'
    };
  }

  if (errorMsg.includes('insufficient')) {
    return {
      title: 'Insufficient Balance',
      message: `You do not have enough tokens to ${
        context?.operationType || 'complete this operation'
      }. Please fund your wallet and try again.`,
      action: {
        label: 'Check Balance',
        handler: () => {
          if (typeof window !== 'undefined') {
            window.open('https://app.tinyman.org/', '_blank');
          }
        }
      }
    };
  }

  if (errorMsg.includes('network') || errorMsg.includes('timeout')) {
    return {
      title: 'Network Issue',
      message: 'We hit a network hiccup. Check your connection and try again.'
    };
  }

  if (errorMsg.includes('request') && errorMsg.includes('pending')) {
    return {
      title: 'Wallet Busy',
      message:
        'Your wallet has another request pending. Complete or cancel it before retrying.',
      action: {
        label: 'Open Wallet',
        handler: () => {
          if (typeof window !== 'undefined') {
            window.open('pera://');
          }
        }
      }
    };
  }

  return {
    title: 'Operation Failed',
    message: `Failed to ${context?.operationType || 'complete the operation'}: ${error.message}`
  };
}
