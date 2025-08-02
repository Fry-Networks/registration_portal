import { useState, useEffect } from 'react';
import { Button, Dialog, DialogPanel, Flex, Title } from '@tremor/react';
import { useModal } from '../../app/modalcontext';
import { useSession } from 'next-auth/react';
import { useToastContext } from '../../hooks/ToastContext';
import { FryConversion } from '../../lib/types';
import { FC_CHECKED, FC_STARTED, FC_UNCHECKED } from '../../lib/utils';

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

  useEffect(() => {
    if (isOpen) {
      const fetchInitialStatus = async () => {
        setIsChecking(true);
        try {
          const response = await fetch('/api/conversion/check_avail_conversion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address: session?.user.address, isLoading: true })
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
  }, [isOpen]);

  const handleCheck = async () => {
    setIsChecking(true);
    try {
      const response = await fetch('/api/conversion/check_avail_conversion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: session?.user.address })
      });
      if (!response.ok) throw new Error('Failed to check availability');
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
        heading: 'Not Available',
        message: 'Wallet Not Eligible for Fry 1.0 Conversion'
      });
    }
    setIsChecking(false);
  };

  const handleStart = () => {
    onStartConversion(csvData);
    closeModal(modalName);
  };

  return (
    <Dialog open={isOpen} onClose={onClose} static={true} className="z-[100]">
      <DialogPanel className="sm:max-w-2xl">
        <Title className="mb-5">Fry 1.0 Conversion</Title>
        <Flex flexDirection="col" className="gap-4">
          <Button
            className="bg-transparent text-slate-900 border-red-600 hover:bg-red-600 hover:border-red-600"
            onClick={handleCheck}
            disabled={isChecking || isChecked}
          >
            Check Availability
          </Button>
          <Button
            className="bg-transparent text-slate-900 border-green-500 hover:bg-green-500 hover:border-green-500"
            onClick={handleStart}
            disabled={!isAvailable}
          >
            {isStarted ? 'Conversion Status' : 'Start Conversion'} 
          </Button>
        </Flex>
        {csvData && (
            <div className="mt-4">
              <Title className="mb-2">Your Fry 1.0 Conversion Data</Title>
              <div className="hidden md:block">
                <table className="min-w-full text-sm shadow border-separate border-spacing-2">
                  <thead>
                    <tr>
                      <th>Fry 1.0 Held</th>
                      <th>Fry Staked (Verification)</th>
                      <th>Fry 1.0 Staked (Cometa)</th>
                      <th>Fry 1.0 Eq. of LP (Cometa)</th>
                      <th>Fry 1.0 Eq. of LP (Tinyman)</th>
                      <th>TOTAL Fry 1.0 Available</th>
                    </tr>
                  </thead>
                  <tbody>
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
                <div className="bg-white shadow p-4 rounded-md">
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
          className="bg-transparent text-slate-900 border-red-600 hover:bg-red-600 hover:border-red-600 mt-4"
          onClick={onClose}
        >
          Close
        </Button>
      </DialogPanel>
    </Dialog>
  );
}
