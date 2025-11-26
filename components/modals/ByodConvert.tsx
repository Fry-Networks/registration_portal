import React, { use, useEffect, useState } from 'react';
import {
  Button,
  Dialog,
  DialogPanel,
  TextInput,
  Select,
  SelectItem,
  Title
} from '@tremor/react';
import { RiCloseLine } from '@remixicon/react';
import { useModal } from '../../app/modalcontext';
import MessageUpdate from '../messageUpdate';
import { useToastContext } from '../../hooks/ToastContext';

interface ByodConvertModalProps {
  modalName: string;
  address?: string;
}

const ByodConvertModal: React.FC<ByodConvertModalProps> = ({
  modalName,
  address
}) => {
  const { modals, closeModal } = useModal();
  const [products, setProducts] = useState([
    {
      name: '',
      key: ''
    }
  ]);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [byodLicense, setByodLicense] = useState('');
  const [miner_key, setMinerKey] = useState('');
  const toast = useToastContext();

  const handleConvert = async () => {
    const response = await fetch('/api/convert-byod', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ address, byod: byodLicense, key: selectedProduct })
    });
    const data = await response.json();
    if (response.ok) {
      toast.success({
        heading: 'Byod Convert Success',
        message: 'Successfully converted your byod license'
      });
      setMinerKey(data.miner_key);
    } else {
      setByodLicense('');
      toast.error({
        heading: 'BYOD Convert Error',
        message: data?.message ?? 'Failed to convert BYOD license'
      });
    }
  };

  useEffect(() => {
    const fetchProducts = async () => {
      console.log('getminertype called');
      const response = await fetch('/api/get_miner_types', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ address })
      });
      const data = await response.json();
      if (data.message === 'ok') {
        setProducts(
          data.data.filter(
            (product: { key: string; name: string }) =>
              !['SDN', 'RDN', 'SVN'].includes(product.key)
          )
        );
      }
    };
    fetchProducts();
  }, [address]);

  return (
    <Dialog
      open={modals[modalName]}
      onClose={() => closeModal(modalName)}
      static={true}
      className="z-[100]"
    >
      <DialogPanel className="sm:max-w-2xl">
        <div className="absolute right-0 top-0 pr-3 pt-3">
          <button
            type="button"
            className="rounded-tremor-small p-2 text-tremor-content-subtle hover:bg-tremor-background-subtle hover:text-tremor-content dark:text-dark-tremor-content-subtle hover:dark:bg-dark-tremor-background-subtle hover:dark:text-tremor-content"
            onClick={() => closeModal(modalName)}
            aria-label="Close"
          >
            <RiCloseLine className="h-5 w-5 shrink-0" aria-hidden={true} />
          </button>
        </div>
        <Title className="mb-5">Convert your BYOD license to a Miner Key</Title>

        <TextInput
          type="text"
          value={byodLicense}
          onChange={(e) => setByodLicense(e.target.value)}
          placeholder="Enter your byod license"
          className="mt-2 mb-2"
          error={byodLicense !== "" && !/^[A-Z0-9]+$/.test(byodLicense)}
          errorMessage="Invalid byod license"
        />
        <Select
          defaultValue="1"
          value={selectedProduct}
          onValueChange={setSelectedProduct}
          className="mb-2"
        >
          {products
            .filter(
              (product) =>
                ['OLWQM', 'OHWQM', 'EM', 'RDN', 'IRM', 'SVN', 'CN'].includes(
                  product.key
                ) === false
            )
            .map((product) => (
              <SelectItem key={product.key} value={product.key}>
                {product.name}
              </SelectItem>
            ))}
        </Select>
        <Button
          onClick={handleConvert}
          disabled={
            byodLicense === '' ||
            selectedProduct === '' ||
            !/^[A-Z0-9]+$/.test(byodLicense)
          }
        >
          Convert
        </Button>
        {miner_key && <p className="mt-2">Your miner key is: {miner_key}</p>}
      </DialogPanel>
    </Dialog>
  );
};

export default ByodConvertModal;
