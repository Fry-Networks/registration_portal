import { useState } from 'react';
import { useRouter } from 'next/router';
import { XIcon, ChevronRightIcon } from '@heroicons/react/outline';

import Sidebar from './Sidebar';
import bgImg from '../assets/background.png';
import Image from 'next/image';

const Stake = ({ data, setData, onNext, onSkip }) => {
    const router = useRouter();
    const [errors, setErrors] = useState<{ [key: string]: string }>({});
    const [isComplete, setIsComplete] = useState(false);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);

    const validateForm = () => {
        const newErrors: { [key: string]: string } = {};
        if (!data.stakeOption) newErrors.stakeOption = 'Please select a staking duration';
        if (!data.amount || isNaN(Number(data.amount)) || Number(data.amount) <= 0)
            newErrors.amount = 'Please enter a valid staking amount';
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async () => {
        if (validateForm()) {
            await fetch('/api/saveStakeInfo', {
                method: 'POST',
                body: JSON.stringify({ stakeOption: data.stakeOption, amount: data.amount }),
                headers: { 'Content-Type': 'application/json' },
            });
            setIsComplete(true);
            onNext(); // Navigate to the confirmation page
        }
    };

    const toggleSidebar = () => {
        setIsSidebarOpen(!isSidebarOpen);
    };

    return (
        <div className="flex h-full">
            <div className='flex flex-col relative w-full h-full'>
                <Image
                    src={bgImg}
                    className="w-screen h-[30vh] object-cover"
                    alt="Background Image"
                />
                <div className="py-8 px-24 relative h-full">
                    <form className="space-y-6">
                        <div className="flex items-center space-x-4">
                            <label className="flex items-center space-x-2 text-white">
                                <input
                                    type="radio"
                                    name="stakeOption"
                                    value="24hr"
                                    checked={data.stakeOption === '24hr'}
                                    onChange={() => setData({ ...data, stakeOption: '24hr' })}
                                    className="form-radio border border-red-600 text-blue-600"
                                />
                                <span>24-Hour Staking</span>
                            </label>
                            <label className="flex items-center space-x-2 text-white">
                                <input
                                    type="radio"
                                    name="stakeOption"
                                    value="30d"
                                    checked={data.stakeOption === '30d'}
                                    onChange={() => setData({ ...data, stakeOption: '30d' })}
                                    className="form-radio border border-red-600 text-blue-600"
                                />
                                <span>30-Day Staking</span>
                            </label>
                        </div>
                        {errors.stakeOption && <span className="text-red-500">{errors.stakeOption}</span>}

                        <div>
                            <label className="block mb-2 text-white">Amount to Stake:</label>
                            <input
                                type="number"
                                min="0"
                                className="w-full p-2 border border-red-600 rounded"
                                placeholder="Enter staking amount"
                                value={data.amount}
                                onChange={(e) => setData({ ...data, amount: e.target.value })}
                            />
                            {errors.amount && <span className="text-red-500">{errors.amount}</span>}
                        </div>
                    </form>

                    {/* Button container positioned at the bottom right */}
                    <div className="absolute bottom-4 right-4 flex space-x-4 text-white">
                        <button
                            type="button"
                            className="px-4 py-2 border border-gray-500 rounded"
                            onClick={onSkip}
                        >
                            Skip
                        </button>
                        <button
                            type="button"
                            className="px-4 py-2 border border-red-600 rounded"
                            onClick={handleSubmit}
                        >
                            Next
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Stake;
