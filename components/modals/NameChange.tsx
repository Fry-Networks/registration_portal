import React, { use, useEffect, useState } from 'react';
import { Button, Dialog, DialogPanel, TextInput, Select, SelectItem, Title } from '@tremor/react';
import { RiCloseLine } from '@remixicon/react';
import { useModal } from '../../app/modalcontext';
import MessageUpdate from '../messageUpdate';

interface NameChangeModalProps {
    modalName: string;
    address?: string;
    miner_key?: string;

}



const NameChangeModal: React.FC<NameChangeModalProps> = ({
    modalName,
    address,
    miner_key
}) => {
    const { modals, closeModal } = useModal();
    const [updateSuccess, setUpdateSuccess] = useState({ status: 'success', message: '' });
    const [name, setName] = useState('');
    const handleSubmit = async () => {
        const response = await fetch('/api/change-name', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ address, name, miner_key })
        });
        const data = await response.json();
        if (response.ok) {
            setUpdateSuccess({ status: 'success', message: 'Successfully changed your device name' });
            setTimeout(() => setUpdateSuccess({ status: 'success', message: '' }), 15_000);
        } else {
            setUpdateSuccess({ status: 'error', message: data.message });
            setTimeout(() => setUpdateSuccess({ status: 'error', message: '' }), 15_000);
        }
    }

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
                        <RiCloseLine
                            className="h-5 w-5 shrink-0"
                            aria-hidden={true}
                        />
                    </button>
                </div>
                <Title className='mb-5' >Change the name of your device</Title>
                <MessageUpdate updateSuccess={updateSuccess} />

                <TextInput
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Enter your new device name"
                    className="mt-2 mb-2"
                    error={name.length > 20 || name.length < 3}
                    errorMessage="Invalid name (check length)"
                />
                <Button onClick={handleSubmit} disabled={name === '' || name.length > 20 || name.length < 3}>Submit</Button>
            </DialogPanel>
        </Dialog>
    );
};

export default NameChangeModal;
