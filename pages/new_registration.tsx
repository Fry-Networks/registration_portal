import {

  Title,
  TextInput,
  Button,
  Flex
} from '@tremor/react';
import { useEffect, useState } from 'react';
import MessageUpdate from '../components/messageUpdate';
import { useModal } from '../app/modalcontext';
import { useWallet } from '@txnlab/use-wallet-react';
import ByodConvertModal from '../components/modals/ByodConvert';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/router';
import RegistrationModal from '../components/modals/registrations/RegistrationModal';
import PageShell from '../components/PageShell';
export default function NewRegistrationPage() {
  const router = useRouter();
  const [minerKey, setMinerKey] = useState('');
  const { data: session, status } = useSession();
  const { openModal, closeModal } = useModal();
  const { activeAccount } = useWallet();
  const isValid = /\b([A-Z]{2,6})-[A-Z0-9]{32}\b/gm.test(minerKey);
  const [updateSuccess, setUpdateSuccess] = useState({ status: 'success', message: '' });

  
  const startRegistration = async () => {
    if (!activeAccount) {
      setUpdateSuccess({ status: 'error', message: 'Please connect your wallet' });
      return;
    }

    const byodResponse = await getIsByod(minerKey, activeAccount.address);
    if (byodResponse.message === 'ok') {
      const isByod = byodResponse.byod && byodResponse.byod.length != 0;
      const minerType = minerKey.split('-')[0];
      console.log('Byod check: ' + isByod + ' | Miner types: ' + minerType);
      if (isByod && isNotAllowedMiner(minerType)) {
        setUpdateSuccess({status: 'error', message: 'This byod miner is not allowed to register'});
        return;
      }
    } 
    else {
      setUpdateSuccess({ status: 'error', message: byodResponse.message });
      return;
    }

    const response = await getMinerType(minerKey, activeAccount.address);
  
    if (response.message === 'ok') {
      const type = response.type;
      openModal('registration')
    } else {
      setUpdateSuccess({ status: 'error', message: response.message });
    }

  }

  const convertByod = () => {
    if (!activeAccount) {
      setUpdateSuccess({ status: 'error', message: 'Please connect your wallet' });
      return;
    }

    openModal('byodConvert');
  }

  return (
    <PageShell title="New Registration" breadcrumb={true}>
      <div className="max-w-xl mx-auto px-4 py-space-8">
        {/* Step indicator */}
        <div className="flex items-center justify-center mb-space-8">
          <div className="flex items-center gap-space-2">
            <div className="flex flex-col items-center">
              <div className="w-10 h-10 rounded-full bg-primary-500 text-ink flex items-center justify-center font-display font-bold text-sm shadow-token-glow">
                1
              </div>
              <span className="text-xs text-primary-500 mt-1 font-medium">Enter Key</span>
            </div>
            <div className="w-12 h-0.5 bg-divider" />
            <div className="flex flex-col items-center">
              <div className="w-10 h-10 rounded-full bg-surface-strong border border-divider text-ink-muted flex items-center justify-center font-display font-bold text-sm">
                2
              </div>
              <span className="text-xs text-ink-muted mt-1 font-medium">Register</span>
            </div>
          </div>
        </div>

        <div className="bg-surface-elevated border border-divider rounded-token-xl p-space-6 md:p-space-8 shadow-token-lg">
          <div className="flex items-center justify-between mb-space-6">
            <h1 className="text-2xl font-display font-bold text-ink">New Registration</h1>
            <button
              onClick={convertByod}
              className="text-sm font-medium text-primary-500 hover:text-primary-400 transition"
            >
              Convert BYOD &rarr;
            </button>
          </div>

          <MessageUpdate updateSuccess={updateSuccess} />

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium text-ink-secondary mb-1 block">
                Miner Key
              </label>
              <input
                type="text"
                placeholder="e.g. AEM-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                value={minerKey}
                onChange={(e) => setMinerKey(e.target.value)}
                className={`w-full bg-surface-strong border rounded-token-md px-4 py-3 text-ink font-mono text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition ${isValid ? 'border-divider' : minerKey ? 'border-error-500' : 'border-divider'}`}
              />
              {minerKey && !isValid && (
                <p className="text-error-500 text-sm mt-1">
                  Invalid miner key format.
                </p>
              )}
            </div>

            <button
              disabled={!isValid}
              onClick={startRegistration}
              className="w-full bg-primary-500 hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed text-ink px-6 py-3 rounded-token-md font-semibold transition shadow-token-glow"
            >
              Start Registration
            </button>
          </div>
        </div>
      </div>

      <RegistrationModal
        modalName='registration'
        minerKey={minerKey}
        address={activeAccount?.address}
      />
      <ByodConvertModal
        modalName='byodConvert'
        address={activeAccount?.address}
        handleRegister={(key: string) => {
          setMinerKey(key);
          closeModal('byodConvert');
          openModal('registration');
        }}
      />
    </PageShell>
  );
}

const isNotAllowedMiner = (minerType: string) : boolean => {
  if (minerType === 'OLWQM' ||  minerType === 'OHWQM' || minerType === 'EM' || minerType === 'RDN'|| minerType === 'IRM' || minerType === 'SVN' || minerType === 'CN') {
    return true; 
  }

  return false;
}

const getMinerType = async (miner_key: string, address: string) => {
  const response = await fetch('/api/miner_types', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ miner_key, address: address })
  });
  const data = await response.json();
  return data;
}

const getIsByod = async (miner_key: string, address: string) => {
  const response = await fetch('/api/is_byod', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ miner_key, address: address })
  });
  const data = await response.json();
  return data;
}
