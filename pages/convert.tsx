import { useState } from 'react';
import PageShell from '../components/PageShell';
import { useWallet } from '@txnlab/use-wallet-react';
import { useSession } from 'next-auth/react';
import { useModal } from '../app/modalcontext';
import FryConversionModal from '../components/modals/FryConversion';
import PostSnapshotConversionModal from '../components/modals/PostSnapshotConversion';
import Fry1CheckModal from '../components/modals/Fry1CheckModal';
import { SwitchHorizontalIcon } from '@heroicons/react/outline';

export default function ConvertPage() {
  const { activeAccount } = useWallet();
  const { data: session } = useSession();
  const { openModal } = useModal();
  const addr = activeAccount?.address || (session?.user as any)?.address;

  const [showFry1Check, setShowFry1Check] = useState(false);
  const [showFryConversion, setShowFryConversion] = useState(false);
  const [showPostSnapshotConversion, setShowPostSnapshotConversion] = useState(false);

  const handleConversion = () => setShowFry1Check(true);

  const handlePostSnapshotConversion = () => {
    setShowPostSnapshotConversion(true);
    openModal('postSnapshotConversion');
  };

  return (
    <PageShell title="Token Conversion" breadcrumb={true}>
      <div className="space-y-8 py-6">
        <div className="max-w-3xl">
          <h1 className="font-display text-2xl font-bold text-ink mb-2">Token Conversion</h1>
          <p className="text-sm text-ink-secondary">
            Convert legacy FRY 1.0 tokens into current-generation assets.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-space-4 max-w-3xl">
          {/* FRY 1.0 → FRY 2.0 */}
          <button
            type="button"
            onClick={handleConversion}
            className="group text-left bg-surface-elevated border border-divider rounded-token-lg p-space-5 hover:shadow-token-md transition border-l-4 border-primary-500"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-token-md bg-primary-500/10 border border-primary-500/20 flex items-center justify-center text-primary-500">
                <SwitchHorizontalIcon className="w-5 h-5" />
              </div>
              <div className="font-semibold text-sm text-ink">December 2024 FRY 1.0 Conversion</div>
            </div>
            <p className="text-xs text-ink-secondary leading-relaxed">
              Review your Dec 1, 2024 FRY 1.0 snapshot balance and choose a conversion into FRY 2.0 or fNode.
            </p>
            <div className="mt-4 text-sm font-medium text-primary-500 group-hover:underline">
              Review snapshot →
            </div>
          </button>

          {/* FRY 1.0 → tFRY */}
          <button
            type="button"
            onClick={handlePostSnapshotConversion}
            className="group text-left bg-surface-elevated border border-divider rounded-token-lg p-space-5 hover:shadow-token-md transition border-l-4 border-accent-500"
          >
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-token-md bg-accent-500/10 border border-accent-500/20 flex items-center justify-center text-accent-500">
                <SwitchHorizontalIcon className="w-5 h-5" />
              </div>
              <div className="font-semibold text-sm text-ink">August 2025 FRY 1.0 Conversion</div>
            </div>
            <p className="text-xs text-ink-secondary leading-relaxed">
              Convert FRY 1.0 acquired after Dec 2024 snapshot into tFRY at 40:1 ratio with no vesting.
            </p>
            <div className="mt-4 text-sm font-medium text-accent-500 group-hover:underline">
              Start conversion →
            </div>
          </button>
        </div>
      </div>

      {/* Modals */}
      {showFry1Check && (
        <Fry1CheckModal
          modalName="fry1Check"
          isOpen={showFry1Check}
          onClose={() => setShowFry1Check(false)}
          onStartConversion={() => {
            setShowFry1Check(false);
            setShowFryConversion(true);
            openModal('fryConversion');
          }}
        />
      )}
      {showFryConversion && (
        <FryConversionModal
          modalName="fryConversion"
          address={addr}
          onClose={() => setShowFryConversion(false)}
        />
      )}
      {showPostSnapshotConversion && (
        <PostSnapshotConversionModal
          modalName="postSnapshotConversion"
          address={addr}
          onClose={() => setShowPostSnapshotConversion(false)}
        />
      )}
    </PageShell>
  );
}
