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
import { parseAlgodError } from '../../lib/algorand/errorParser';
import { useTheme } from 'next-themes';

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
	const { resolvedTheme } = useTheme();
	const isDark = resolvedTheme !== 'light';
	const { modals, closeModal } = useModal();
	const [isProcessing, setIsProcessing] = useState(false);
	const { data: session } = useSession();
	const toast = useToastContext();
	const [selectedOption, setSelectedOption] = useState('');
	const [acknowledged, setAcknowledged] = useState(false);

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
        setAcknowledged(false);
    } else {
        setSelectedOption('');
        setAcknowledged(false);
    }
}, [device, options]);

const warningCopy: Record<string, { title: string; body: string; ack: string }> = {
  'Registration Staking': {
    title: 'Withdrawing registration stake stops device rewards.',
    body: 'Keep the registration stake in place to stay eligible for payouts. Removing it pauses all earnings for this device until you re-stake.',
    ack: 'I understand withdrawing registration stake stops all device rewards until I re-stake.'
  },
  'Node Staking': {
    title: 'Withdrawing node stake stops node earnings.',
    body: 'Your node must stay staked to earn rewards. Removing the stake pauses node payouts until you re-stake and resume operation.',
    ack: 'I understand withdrawing node stake pauses node earnings until I re-stake.'
  }
};

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
			const parsed = parseAlgodError(error);
			const message =
				parsed?.userMessage ||
				(error instanceof Error ? error.message : 'Failed to withdraw the token. Please contact us before you try again');
			console.error('[WithdrawAll] Failed to withdraw', parsed?.rawMessage || error);

			toast.error({
				heading: 'Withdraw Error',
				message
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
				className="z-[200]"
			>
				{/* Mirror withdraw modal palette so registration/node unstake dialogs stay consistent. */}
				<DialogPanel
					/* Keep the sheet below the navbar and above holiday overlays. */
					className="sm:max-w-xl bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100"
					style={{ marginTop: 'calc(var(--navbar-height, 64px) + 12px)' }}
				>
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
					<div className={`rounded border px-4 py-3 text-sm mb-4 ${isDark ? 'border-amber-400/40 bg-amber-500/10 text-amber-100' : 'border-amber-300 bg-amber-50 text-slate-900'}`}>
						<p className={`font-semibold ${isDark ? 'text-amber-50' : 'text-amber-800'}`}>
							Withdrawing registration or node stakes stops rewards.
						</p>
						<p className={`text-xs mt-1 ${isDark ? 'text-amber-100/90' : 'text-slate-800'}`}>
							Remove the stake only if you understand the device (or node) will stop earning until you re-stake and rejoin reward cycles.
						</p>
					</div>					
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
											onChange={() => {
												setSelectedOption(option);
												setAcknowledged(false);
											}}
											className="form-radio text-blue-600 h-4 w-4 mr-3"
											disabled={option === 'Registration Staking' ? ( isRegistrationStaked(device) ? false : true ) : isNodeStaked(device) ? false : true}
										/>
										<span>{option}</span>
									</label>
								);
							})}
						</div>
					</Card>
					{selectedOption && warningCopy[selectedOption] && (
						<div className={`mt-4 rounded border px-4 py-3 text-sm ${isDark ? 'border-amber-400/40 bg-amber-500/10 text-amber-100' : 'border-amber-300 bg-amber-50 text-slate-900'}`}>
							<p className={`font-semibold ${isDark ? 'text-amber-50' : 'text-amber-800'}`}>{warningCopy[selectedOption].title}</p>
							<p className={`text-xs mt-1 ${isDark ? 'text-amber-100/90' : 'text-slate-800'}`}>{warningCopy[selectedOption].body}</p>
							<label className={`mt-3 flex items-center gap-2 text-xs ${isDark ? 'text-amber-50' : 'text-slate-900'}`}>
								<input
									type="checkbox"
									className={`h-4 w-4 rounded focus:ring-amber-400 ${isDark ? 'border-amber-200 text-amber-200' : 'border-amber-400 text-amber-600'}`}
									checked={acknowledged}
									onChange={(event) => setAcknowledged(event.target.checked)}
								/>
								<span>{warningCopy[selectedOption].ack}</span>
							</label>
						</div>
					)}
					<Flex
						flexDirection="row"
						justifyContent="center"
						className="gap-3 w-full mt-5"
					>
						{/* Align action buttons with the withdraw modal colors for a unified experience. */}
						<Button
							className={`bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600 ${isDark ? 'text-white' : 'text-black'}`}
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
							className={`relative flex items-center justify-center bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600 ${isDark ? 'text-white' : 'text-black'} ${
								isProcessing || !acknowledged || !selectedOption ? 'cursor-not-allowed opacity-60' : 'cursor-default'
							}`}
							disabled={isProcessing || !acknowledged || !selectedOption}
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
