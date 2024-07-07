import React, { useState } from 'react';
import { Button, Dialog, DialogPanel, TextInput, Title } from '@tremor/react';
import { RiCloseLine } from '@remixicon/react';
import { useModal } from '../../../app/modalcontext';
import MessageUpdate from '../../messageUpdate';

interface HardwareREGModalProps {
    modalName: string;
    minerKey: string;
    address?: string;
}

const HardwareREG: React.FC<HardwareREGModalProps> = ({
    modalName,
    minerKey,
    address
}) => {
    const { modals, closeModal } = useModal();
    const [isLoading, setIsLoading] = useState(false);
    const [updateSuccess, setUpdateSuccess] = useState({status: 'success', message: ''});
    const [names, setNames] = useState({ first_name: '', last_name: '' });
    const [email, setEmail] = useState('');
    const [orderNumber, setOrderNumber] = useState('');
    const [errors, setErrors] = useState({ first_name: '', last_name: '', email: '', orderNumber: '' });

    const validateInput = (name: string, value: string) => {
        let regex;
        let error = '';
        switch (name) {
            case 'first_name':
            case 'last_name':
                regex = /^[a-zA-Z\ -]+$/;
                error = regex.test(value) ? '' : 'Only alphabets are allowed.';
                break;
            case 'email':
                regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                error = regex.test(value) ? '' : 'Invalid email format.';
                break;
            case 'orderNumber':
                regex = /^[0-9]{5}$/;
                error = regex.test(value) ? '' : 'Order number can only contain uppercase letters and numbers. Must be 5 characters long.';
                break;
            default:
                break;
        }
        setErrors(prevErrors => ({ ...prevErrors, [name]: error }));
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        if (name === 'first_name' || name === 'last_name') {
            setNames(prevNames => ({ ...prevNames, [name]: value }));
        } else if (name === 'email') {
            setEmail(value);
        } else if (name === 'orderNumber') {
            setOrderNumber(value);
        }
        validateInput(name, value);
    };

    const handleSubmit = async () => {
        const hasErrors = Object.values(errors).some(error => error !== '');
        if (hasErrors) return;
        const response = await fetch('/api/registrations/hardware', { // Replace with your actual API endpoint
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ names, email, orderNumber, miner_key: minerKey, address }),
        });

        const { message } = await response.json();
        if (!response.ok) {
            setUpdateSuccess({ status: 'error', message: 'Failed to register' });
            setTimeout(() => setUpdateSuccess({status: 'error', message}), 15_000);
        } else {
            setUpdateSuccess({ status: 'success', message: 'Successfully registered' });
            setTimeout(() => setUpdateSuccess({status: 'success', message}), 15_000);
        }

    };

    return (
        <Dialog
            open={modals[modalName]}
            onClose={() => closeModal(modalName)}
            static={true}
            className="z-[100]"
        >
            <DialogPanel className="sm:max-w-2xl p-6">
                <div className="flex justify-end">
                    <button
                        type="button"
                        className="asrounded-tremor-small p-2 text-tremor-content-subtle hover:bg-tremor-background-subtle hover:text-tremor-content dark:text-dark-tremor-content-subtle hover:dark:bg-dark-tremor-background-subtle hover:dark:text-tremor-content"
                        onClick={() => closeModal(modalName)}
                        aria-label="Close"
                    >
                        <RiCloseLine
                            className="h-5 w-5 shrink-0"
                            aria-hidden={true}
                        />
                    </button>
                </div>
                <div className="space-y-4">
                    <MessageUpdate updateSuccess={updateSuccess} />
                    <Title>Hardware registration</Title>
                    <TextInput
                        name="first_name"
                        placeholder="Enter your first name"
                        value={names.first_name}
                        onChange={handleInputChange}
                        errorMessage={errors.first_name}
                        error={errors.first_name !== ''}
                    />
                    <TextInput
                        name="last_name"
                        placeholder="Enter your last name"
                        value={names.last_name}
                        onChange={handleInputChange}
                        errorMessage={errors.last_name}
                        error={errors.last_name !== ''}
                    />
                    <TextInput
                        name="email"
                        placeholder="Enter your email"
                        value={email}
                        onChange={handleInputChange}
                        errorMessage={errors.email}
                        error={errors.email !== ''}
                    />
                    <TextInput
                        name="orderNumber"
                        placeholder="Enter your order number"
                        value={orderNumber}
                        onChange={handleInputChange}
                        errorMessage={errors.orderNumber}
                        error={errors.orderNumber !== ''}
                    />
                </div>
                <div className="mt-4">
                    <Button
                        onClick={handleSubmit}
                        disabled={Object.values(errors).some(error => error !== '')}
                    >
                        Submit
                    </Button>
                </div>
            </DialogPanel>
        </Dialog>
    );
};

export default HardwareREG;
