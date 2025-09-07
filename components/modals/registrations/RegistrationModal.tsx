import React, { useState } from 'react';
import { Button, Dialog, DialogPanel, TextInput, Title } from '@tremor/react';
import { RiCloseLine } from '@remixicon/react';
import { useModal } from '../../../app/modalcontext';
import MessageUpdate from '../../messageUpdate';
import Link from 'next/link';

interface REGModalProps {
    modalName: string;
    minerKey: string;
    address?: string;
}

const RegistrationModal: React.FC<REGModalProps> = ({
    modalName,
    minerKey,
    address
}) => {
    const { modals, closeModal } = useModal();
    const [updateSuccess, setUpdateSuccess] = useState({status: 'success', message: ''});
    const [names, setNames] = useState({ first_name: '', last_name: '' });
    const [email, setEmail] = useState('');
    const [errors, setErrors] = useState({ first_name: '', last_name: '', email: '' });

    const getPortalLink = () => {
        const minerType = minerKey.split('-')[0];

        if (['OHAQM', 'IHAQM', 'ILAQM'].includes(minerType)) {
            return "https://air.frynetworks.com";
        } else if (['AOWSCM', 'AOWCM', 'AIWCM', 'AOSCM', 'AISCM', 'AOTCM', 'AITCM', 'AIWSCM'].includes(minerType)) {
            return "https://camera.frynetworks.com";
        } else if (['HWM', 'LWM'].includes(minerType)) {
            return "https://weather.frynetworks.com";
        } else if (['OLWQM', 'OHWQM'.includes(minerType)]) {
            return "https://water.frynetworks.com";
        } else if (minerType === 'EM') {
            return "https://energy.frynetworks.com";
        } else if (minerType === 'IRM') {
            return "https://radiation.frynetworks.com";
        }

        return ""
    }

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
        }
        validateInput(name, value);
    };

    const handleSubmit = async () => {
        const hasErrors = Object.values(errors).some(error => error !== '');
        if (hasErrors) return;
        const response = await fetch('/api/registrations/create', { // Replace with your actual API endpoint
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ names, email,  miner_key: minerKey, address }),
        });
        const { message } = await response.json();
        if (!response.ok) {
            setUpdateSuccess({ status: 'error', message });
            setTimeout(() => setUpdateSuccess({status: 'error', message: ''}), 15_000);
        } else {
            //clear fields
            setNames({first_name: '', last_name: ''});
            setEmail('')
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
                    <Title>Device registration</Title>
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
                </div>
                {/* {
                    getPortalLink()?.length > 0 && 
                    <div className="mt-4">
                        <Link href={getPortalLink()} passHref>
                            <a className="text-blue-500 hover:underline">
                                Want to go to portal before you register?
                            </a>
                        </Link>
                    </div>
                } */}
                
                <div className="mt-4">
                    <Button
                        onClick={handleSubmit}
                        disabled={Object.values(errors).some(error => error !== '') || Object.values(names).some(name => name === '') || email === '' }
                    >
                        Submit
                    </Button>
                </div>
            </DialogPanel>
        </Dialog>
    );
};

export default RegistrationModal;