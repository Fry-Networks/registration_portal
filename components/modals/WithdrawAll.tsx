import { Button, Dialog, DialogPanel, Flex, Title, Card, Text } from '@tremor/react';
import { useModal } from '../../app/modalcontext';
import { useState, useMemo, useEffect } from 'react';
import { RiCloseLine } from '@remixicon/react';
import { Device, Product } from '../../lib/types';
import MessageUpdate from '../messageUpdate';
import { useSession } from 'next-auth/react';
import { useToastContext } from '../../hooks/ToastContext';
import { isNodeStaked, isRegistrationStaked } from '../../lib/utils';
import { secureFetch } from '../../lib/api/secureFetch';

export default function WithdrawAllModal({
	modalName,
	device,
	product,
	handleWithdrawAll
}: {
	modalName: string;
	device: Device;
	product: Product;
	handleWithdrawAll: (device: Device) => Promise<void>;
}) {
	const { modals, closeModal } = useModal();
	const [isProcessing, setIsProcessing] = useState(false);
	const { data: session } = useSession();
	const toast = useToastContext();
	const [selectedOption, setSelectedOption] = useState('');

	// Options depend on product: AI Edge has no Node Staking
const options = useMemo(() => {
	const isEdge = (product?.name || '').toLowerCase().includes('edge');
	return isEdge ? ['Registration Staking'] : ['Registration Staking', 'Node Staking'];
}, [product?.name]);

useEffect(() => {
    const defaultOption = options.find((option) => {
        const isDisabled = !isRegistrationStaked(device) && option === options[0];
        return !isDisabled;
    });

    if (defaultOption) {
        setSelectedOption(defaultOption);
    }
}, [device, options]);

	const withdrawAll = async () => {
		setIsProcessing(true);
		try {
			// if (isRegistrationStaked(device)) {
			if (selectedOption === 'Registration Staking') {
				const response = await secureFetch('/api/stake/r-withdraw', {
					address: session?.user.address,
					miner_key: device.miner_key
				});

				if (!response.ok) {
					toast.error({
						heading: 'Withdraw Error',
						message: 'Failed to withdraw registration staking'
					});

					setIsProcessing(false);
					return;
				}

				const result = await response.json();
				toast.success({
					heading: 'Withdraw Registration Success',
					message: `Tx: ${result.txId}`
				});
			}

			// if (isNodeStaked(device)) {
			if (selectedOption === 'Node Staking') {
				const response = await secureFetch('/api/stake/n-withdraw', {
					address: session?.user.address,
					miner_key: device.miner_key
				});

				if (!response.ok) {
					toast.error({
						heading: 'Withdraw Error',
						message: 'Failed to withdraw node staking'
					});

					setIsProcessing(false);
					return;
				}

				const result = await response.json();
				toast.success({
					heading: 'Withdraw Node Success',
					message: `Tx: ${result.txId}`
				});
			}

			setIsProcessing(false);
			closeModal(modalName);
			// setSelectedOption(options[0])
			handleWithdrawAll(device);
		} catch (error) {
			console.error(error);

			toast.error({
				heading: 'Withdraw Error',
				message:
					'Failed to withdraw the token. Please contact us before you try again'
			});
			setIsProcessing(false);
			return;
		}
	};

	return (
		<div>
			<Dialog
				open={modals[modalName]}
				onClose={() => {
						if(!isProcessing) {
							// setSelectedOption(options[0])
							closeModal(modalName)
						}
					}
				}
				static={true}
				className="z-[100]"
			>
				{/* Mirror withdraw modal palette so registration/node unstake dialogs stay consistent. */}
				<DialogPanel className="sm:max-w-xl bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100">
					<div className="absolute right-0 top-0 pr-3 pt-3">
						<button
							type="button"
							className="rounded-tremor-small p-2 text-tremor-content-subtle hover:bg-tremor-background-subtle hover:text-tremor-content dark:text-dark-tremor-content-subtle hover:dark:bg-dark-tremor-background-subtle hover:dark:text-tremor-content"
							onClick={() => {
									if(!isProcessing) {
										// setSelectedOption(options[0])
										closeModal(modalName)
									}
								}
							}
							aria-label="Close"
						>
							<RiCloseLine className="h-5 w-5 shrink-0" aria-hidden={true} />
						</button>
					</div>
					{/* Keep title styling aligned with the verification withdraw modal for readability. */}
					<Title className="mb-5 text-gray-900 dark:text-gray-100">Unstake</Title>
					{/* <Flex
						flexDirection="col"
						alignItems="stretch"
						justifyContent="center"
						className="gap-3 w-full mt-5 text-slate-900"
					>
						<p>Do you want to withdraw registration and node staking?</p>
					</Flex> */}
					{/* Re-use the dark-mode friendly card palette so option selectors remain legible. */}
					<Card className="max-w-md mx-auto p-4 bg-white text-gray-900 dark:bg-gray-800 dark:text-gray-100 border border-amber-500/30">
						<Title className='text-[16px] text-gray-900 dark:text-gray-100'>Registration or Node Staking?</Title>
						<Text className="mb-4 text-gray-700 dark:text-gray-200">Choose one of the following:</Text>

						<div className="space-y-2">
							{options.map((option) => {
								const isDisabled = !isRegistrationStaked(device) && option === options[0];

								return (
									<label
										key={option}
										className={`flex items-center p-3 border rounded-lg transition-all text-gray-900 dark:text-gray-100 ${ 
											selectedOption === option && !isDisabled ? 'border-amber-500 bg-amber-50 dark:bg-amber-500/20' : 'border-gray-300 dark:border-gray-600'
										} ${isDisabled ? 'bg-gray-300 dark:bg-gray-700 cursor-not-allowed' : 'cursor-pointer'}`}
									>
										<input
											type="radio"
											name="custom-radio"
											value={option}
											checked={selectedOption === option}
											onChange={() => setSelectedOption(option)}
											className="form-radio text-blue-600 h-4 w-4 mr-3"
											disabled={option === 'Registration Staking' ? ( isRegistrationStaked(device) ? false : true ) : isNodeStaked(device) ? false : true}
										/>
										<span>{option}</span>
									</label>
								);
							})}
						</div>
					</Card>
					<Flex
						flexDirection="row"
						justifyContent="center"
						className="gap-3 w-full mt-5"
					>
						{/* Align action buttons with the withdraw modal colors for a unified experience. */}
						<Button
							className="bg-transparent text-white border-red-600 hover:bg-red-600 hover:border-red-600"
							onClick={() => {
									if(!isProcessing) {
										// setSelectedOption(options[0])
										closeModal(modalName)
									}
								}
							}
						>
							Close
						</Button>
						<Button
							className={`relative flex items-center justify-center bg-transparent text-white border-red-600 hover:bg-red-600 hover:border-red-600 ${
								isProcessing ? 'cursor-not-allowed' : 'cursor-default'
							}`}
							onClick={() => withdrawAll()}
						>
							{isProcessing ? (
								<svg
									className="animate-spin h-6 w-6 text-red-500"
									xmlns="http://www.w3.org/2000/svg"
									fill="none"
									viewBox="0 0 24 24"
								>
									<defs>
										<linearGradient
											id="redGradient"
											x1="0%"
											y1="0%"
											x2="100%"
											y2="0%"
										>
											<stop offset="0%" stopColor="#ff0000" />
											<stop offset="50%" stopColor="#ff4d4d" />
											<stop offset="100%" stopColor="#ff9999" />
										</linearGradient>
									</defs>
									<circle
										cx="12"
										cy="12"
										r="10"
										stroke="url(#redGradient)"
										strokeWidth="4"
										fill="none"
										strokeLinecap="round"
									/>
								</svg>
							) : (
								'Yes'
							)}
						</Button>
					</Flex>
				</DialogPanel>
			</Dialog>
		</div>
	);
}
