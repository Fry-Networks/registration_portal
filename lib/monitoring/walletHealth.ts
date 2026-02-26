import { getAlgoBalance } from '../algorand/balances';
import { notifyDiscordError } from '../discord-webhook';

export interface WalletHealthMetrics {
  balanceHealth: number;
  connectionStability: number;
  overallScore: number;
  recentFailures: number;
  recommendations: string[];
}

const FAILURE_HISTORY = new Map<string, number[]>();
const FAILURE_WINDOW_MS = 60 * 60 * 1000;

const recordFailure = (address: string) => {
  const history = FAILURE_HISTORY.get(address) ?? [];
  history.push(Date.now());
  FAILURE_HISTORY.set(address, history);
};

const getRecentFailureCount = (address: string): number => {
  const history = FAILURE_HISTORY.get(address);
  if (!history) return 0;
  const now = Date.now();
  const filtered = history.filter((ts) => now - ts <= FAILURE_WINDOW_MS);
  FAILURE_HISTORY.set(address, filtered);
  return filtered.length;
};

export async function assessWalletHealth(address: string): Promise<WalletHealthMetrics> {
  const [balanceHealth, connectionStability] = await Promise.all([
    assessBalanceHealth(address),
    assessConnectionStability(address)
  ]);

  const recentFailures = getRecentFailureCount(address);
  const failureScore = Math.max(0, 1 - recentFailures / 10);

  const overallScore = Number(
    (balanceHealth * 0.4 + connectionStability * 0.4 + failureScore * 0.2).toFixed(2)
  );

  const recommendations: string[] = [];
  if (balanceHealth < 0.5) {
    recommendations.push('Low ALGO balance: deposit ALGO to cover fees.');
  }
  if (connectionStability < 0.5) {
    recommendations.push('Connection issues detected. Check wallet network status.');
  }
  if (recentFailures > 3) {
    recommendations.push('Frequent failures observed. Review recent activity.');
  }

  return {
    balanceHealth,
    connectionStability,
    overallScore,
    recentFailures,
    recommendations
  };
}

export async function monitorWalletHealth(
  address: string,
  context?: { minerKey?: string; operation?: string },
  threshold = 0.6
): Promise<void> {
  try {
    const health = await assessWalletHealth(address);
    if (health.overallScore < threshold) {
      recordFailure(address);
      const metadata: Record<string, unknown> = {
        balanceHealth: health.balanceHealth,
        connectionStability: health.connectionStability,
        overallScore: health.overallScore,
        recentFailures: health.recentFailures,
        recommendations: health.recommendations
      };
      await notifyDiscordError({
        minerKey: context?.minerKey ?? 'UNKNOWN',
        walletAddress: address,
        issueType: 'WALLET_HEALTH_ALERT',
        part: context?.operation ?? 'walletHealthMonitor',
        errorMessage: `Wallet health degraded (${Math.round(health.overallScore * 100)}%)`,
        metadata
      });
    }
  } catch (error) {
    console.warn('[walletHealth] failed to monitor health for', address, error);
  }
}

async function assessBalanceHealth(address: string): Promise<number> {
  try {
    const balance = await getAlgoBalance(address);
    if (balance === null) {
      return 0;
    }
    const recommended = 0.1;
    return Math.min(balance / recommended, 1);
  } catch {
    return 0;
  }
}

async function assessConnectionStability(address: string): Promise<number> {
  const attempts = 3;
  let success = 0;

  for (let i = 0; i < attempts; i++) {
    const balance = await getAlgoBalance(address);
    if (balance !== null) {
      success += 1;
    }
    if (i < attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return success / attempts;
}
