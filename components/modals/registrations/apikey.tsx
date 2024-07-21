import React, { useState } from 'react';
import { Button, Dialog, DialogPanel, TextInput, Title } from '@tremor/react';
import { RiCloseLine } from '@remixicon/react';
import { useModal } from '../../../app/modalcontext';
import MessageUpdate from '../../messageUpdate';

interface ApiKeyREGModalProps {
    modalName: string;
    minerKey: string;
    address?: string;
}

const ApiKeyREG: React.FC<ApiKeyREGModalProps> = ({
    modalName,
    minerKey,
    address
}) => {
    const { modals, closeModal } = useModal();
    const [updateSuccess, setUpdateSuccess] = useState({status: 'success', message: ''});
    const [names, setNames] = useState({ first_name: '', last_name: '' });
    const [email, setEmail] = useState('');
    const [apiKey, setApiKey] = useState(''); 
    const [mac, setMac] = useState('');
    const [errors, setErrors] = useState({ first_name: '', last_name: '', email: '', apikey: '', mac: '' });

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
            case 'apikey':
                error = value.length < 3 ? 'API key must be at least 3 characters long' : /^\S+$/.test(value) ? '' : 'Invalid input';
                break;
            case 'mac':
                error = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/g.test(value) ? '' : 'Invalid MAC address';
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
        } else if (name === 'apikey') {
            setApiKey(value);
        } else if (name === 'mac') {
            setMac(value);
        }
        validateInput(name, value);
    };

    const handleSubmit = async () => {
        const hasErrors = Object.values(errors).some(error => error !== '');
        if (hasErrors) return;
        const response = await fetch('/api/registrations/apikey', { // Replace with your actual API endpoint
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ names, email,  miner_key: minerKey, address, apikey: apiKey, mac }),
        });
        const { message } = await response.json();
        if (!response.ok) {
            setUpdateSuccess({ status: 'error', message });
            setTimeout(() => setUpdateSuccess({status: 'error', message: ''}), 15_000);
        } else {
            setUpdateSuccess({ status: 'success', message: 'Successfully registered' });
            setTimeout(() => setUpdateSuccess({status: 'success', message: ''}), 15_000);
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
                    <Title>API Device registration</Title>
                    <TextInput
                        name="first_name"
                        placeholder="Enter your first name"
                        value={names.first_name}
                        onChange={handleInputChange}
                        errorMessage={errors.first_name}
                        error={errors.first_name !== '' }
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
                        name="apikey"
                        placeholder="Enter your API key"
                        value={apiKey}
                        onChange={handleInputChange}
                        error= {errors.apikey !== ''}
                        errorMessage={errors.apikey}
                    />
                     <TextInput
                        name="mac"
                        placeholder="Enter your MAC address"
                        value={mac}
                        onChange={handleInputChange}
                        error= {errors.mac !== ''}
                        errorMessage={errors.mac}
                    />
                </div>
                <div className="mt-4">
                    <Button
                        onClick={handleSubmit}
                        disabled={Object.values(errors).some(error => error !== '') || Object.values(names).some(name => name === '') || email === '' || apiKey === '' || mac === ''}
                    >
                        Submit
                    </Button>
                </div>
            </DialogPanel>
        </Dialog>
    );
};

export default ApiKeyREG;