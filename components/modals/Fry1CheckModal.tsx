import { useState, useEffect } from 'react';
import { Button, Dialog, DialogPanel, Flex, Title } from '@tremor/react';
import { useModal } from '../../app/modalcontext';
import { useSession } from 'next-auth/react';
import { useToastContext } from '../../hooks/ToastContext';
import { FryConversion } from '../../lib/types';
import { FC_CHECKED, FC_STARTED, FC_UNCHECKED } from '../../lib/utils';
import { useTheme } from 'next-themes';

export default function Fry1CheckModal({
  modalName,
  onStartConversion,
  isOpen,
  onClose
}) {
  const { modals, closeModal } = useModal();
  const { data: session } = useSession();
  const toast = useToastContext();
  const [isChecked, setIsChecked] = useState(false);
  const [isStarted, setIsStarted] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [isAvailable, setIsAvailable] = useState(false);
  const [csvData, setCsvData] = useState<FryConversion | null>(null);
  const [now, setNow] = useState(new Date());
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';

  useEffect(() => {
    if (isOpen && session?.user?.address) {
      const fetchInitialStatus = async () => {
        setIsChecking(true);
        try {
          const response = await fetch('/api/conversion/check_avail_conversion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: session.user.address, isLoading: true })
          });

          if (!response.ok) throw new Error('Failed to check availability');
          const result = await response.json();
          
          if (result.isChecked == FC_CHECKED) {
            setCsvData(result.data);
            setIsAvailable(true);
            setIsChecked(true);
          } else if (result.isChecked == FC_STARTED) {
            setCsvData(result.data);
            setIsAvailable(true);
            setIsChecked(true);
            setIsStarted(true);
          }
        } catch (e) {
          setIsAvailable(false);
          setCsvData(null);
        }
        setIsChecking(false);  
      }

      fetchInitialStatus();
      setNow(new Date());

    }
  }, [isOpen, session?.user?.address]);

  const handleCheck = async () => {
    setIsChecking(true);
    try {
      const response = await fetch('/api/conversion/check_avail_conversion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: session?.user.address })
      });

      if (!response.ok) {
        // Parse error response to get specific code
        const errorData = await response.json().catch(() => ({}));
        let errorMessage = 'Unable to check conversion eligibility. Please try again.';

        if (errorData.code === 'DEVICE_NOT_FOUND') {
          errorMessage = 'This wallet was not included in the Fry 1.0 conversion snapshot. Only wallets holding FRY 1.0 at the snapshot date are eligible. If you believe this is an error, please contact support.';
        } else if (errorData.code === 'INVALID_INPUT') {
          errorMessage = 'Your Fry 1.0 conversion balance is zero. This may mean your conversion has already been completed, or you had no eligible balance at the snapshot.';
        } else if (errorData.code === 'WALLET_MISMATCH') {
          errorMessage = 'The connected wallet does not match your session. Please disconnect and reconnect your wallet.';
        }

        setIsAvailable(false);
        setCsvData(null);
        toast.error({
          heading: 'Not Eligible',
          message: errorMessage
        });
        setIsChecking(false);
        return;
      }

      const result = await response.json();
      setCsvData(result.data);
      setIsAvailable(true);
      toast.success({
        heading: 'Available',
        message: 'Fry 1.0 is available for conversion.'
      });
    } catch (e) {
      setIsAvailable(false);
      setCsvData(null);
      toast.error({
        heading: 'Connection Error',
        message: 'Unable to check conversion eligibility. Please check your connection and try again.'
      });
    }
    setIsChecking(false);
  };

  const handleStart = () => {
    onStartConversion(csvData);
    closeModal(modalName);
  };

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      static={true}
      className="z-[320]" // Keep the initial Fry 1.0 conversion step above navbar + seasonal chrome
    >
      <DialogPanel
        className={`sm:max-w-2xl ${
          isDark
            ? 'bg-[#0b0b0f] text-white border border-gray-800 shadow-[0_18px_45px_rgba(0,0,0,0.6)]'
            : 'bg-white text-slate-900 border border-slate-200 shadow-[0_18px_45px_rgba(15,23,42,0.12)]'
        }`}
      >
        <Title className={`mb-5 ${isDark ? 'text-white' : 'text-slate-900'}`}>Fry 1.0 Conversion</Title>
        <Flex flexDirection="col" className="gap-4">
          <Button
            className={`bg-transparent ${isDark ? 'text-white border-red-600 hover:bg-red-600 hover:border-red-600' : 'text-slate-900 border-red-600 hover:bg-red-50 hover:border-red-600'}`}
            onClick={handleCheck}
            disabled={isChecking || isChecked}
          >
            Check Availability
          </Button>
          <Button
            className={`bg-transparent ${isDark ? 'text-white border-green-500 hover:bg-green-600 hover:border-green-600' : 'text-slate-900 border-green-600 hover:bg-green-50 hover:border-green-600'}`}
            onClick={handleStart}
            disabled={!isAvailable}
          >
            {isStarted ? 'Conversion Status' : 'Start Conversion'} 
          </Button>
        </Flex>
        {csvData && (
            <div className="mt-4">
              <Title className={`mb-2 ${isDark ? 'text-white' : 'text-slate-900'}`}>Your Fry 1.0 Conversion Data</Title>
              <div className="hidden md:block">
                <table className={`min-w-full text-sm shadow border-separate border-spacing-2 ${isDark ? 'text-gray-100' : 'text-slate-900'}`}>
                  <thead className={isDark ? 'bg-gray-900/60 text-gray-200' : 'bg-slate-100 text-slate-800'}>
                    <tr>
                      <th>Fry 1.0 Held</th>
                      <th>Fry Staked (Verification)</th>
                      <th>Fry 1.0 Staked (Cometa)</th>
                      <th>Fry 1.0 Eq. of LP (Cometa)</th>
                      <th>Fry 1.0 Eq. of LP (Tinyman)</th>
                      <th>TOTAL Fry 1.0 Available</th>
                    </tr>
                  </thead>
                  <tbody className={isDark ? 'bg-gray-900/40' : 'bg-white'}>
                    <tr>
                      <td>{csvData.held}</td>
                      <td>{csvData.verification}</td>
                      <td>{csvData.cometaStaking}</td>
                      <td>{csvData.cometaLp}</td>
                      <td>{csvData.tinymanLp}</td>
                      <td>{csvData.amount}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div className="block md:hidden space-y-4">
                <div className={`${isDark ? 'bg-gray-900/60 text-gray-100 border border-gray-800' : 'bg-white text-slate-900 shadow'} p-4 rounded-md`}>
                  <div><strong>Fry 1.0 Held:</strong> {csvData.held}</div>
                  <div><strong>Fry Staked (Verification):</strong> {csvData.verification}</div>
                  <div><strong>Fry 1.0 Staked (Cometa):</strong> {csvData.cometaStaking}</div>
                  <div><strong>LP Staked (Cometa Pools):</strong> {csvData.cometaLp}</div>
                  <div><strong>Fry 1.0 Eq. of LP:</strong> {csvData.tinymanLp}</div>
                  <div><strong>TOTAL Fry 1.0 Available:</strong> {csvData.amount}</div>
                </div>
              </div>
            </div>
        )}
        <Button
          className={`bg-transparent ${isDark ? 'text-white border-red-600 hover:bg-red-600 hover:border-red-600' : 'text-slate-900 border-red-600 hover:bg-red-50 hover:border-red-600'} mt-4`}
          onClick={onClose}
        >
          Close
        </Button>
      </DialogPanel>
    </Dialog>
  );
}
