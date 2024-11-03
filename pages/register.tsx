import React, { useState } from 'react';
import { useRouter } from 'next/router';
import Sidebar from '../components/Sidebar';
import DeviceInfo from '../components/DeviceInfo';
import MapInfo from '../components/MapInfo';
import Stake from '../components/Stake';
import { ChevronRightIcon } from '@heroicons/react/outline';

export default () => {
    const router = useRouter();
    const [currentSection, setCurrentSection] = useState(0);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [deviceStatus, setDeviceStatus] = useState(false);
    const [locationStatus, setLocationStatus] = useState(false);
    const [stakeStatus, setStakeStatus] = useState(false);

    // State for each form's data
    const [deviceInfoData, setDeviceInfoData] = useState({
        email: '',
        firstName: '',
        lastName: '',
        nickname: '',
        rewardWallet: '',
    });
    const [mapInfoData, setMapInfoData] = useState({ latitude: '', longitude: '' });
    const [stakeData, setStakeData] = useState({ stakeOption: '', amount: '' });

    const sections = [
        { id: 0, title: 'Device Information' },
        { id: 1, title: 'Map Information' },
        { id: 2, title: 'Stake' },
    ];

    const handleNext = () => {
        switch (currentSection) {
            case 0:
                setDeviceStatus(true);
                break;
            case 1:
                setLocationStatus(true);
                break;
            case 2:
                setStakeStatus(true);
                break;
            default:
                break;
        }
        if (currentSection < sections.length - 1) {
            setCurrentSection((prev) => prev + 1);
        } else {
            router.push('/');
        }
    };

    const handleSkip = () => {
        if (currentSection < sections.length - 1) {
            setCurrentSection((prev) => prev + 1);
        } else {
            router.push('/');
        }
    };

    const toggleSidebar = () => {
        setIsSidebarOpen(!isSidebarOpen);
    };

    return (
        <div className="flex h-[calc(100vh-96px)] overflow-hidden">
            <Sidebar
                completionStatus={{
                    device: deviceStatus,
                    map: locationStatus,
                    stake: stakeStatus,
                }}
                isOpen={isSidebarOpen}
                toggleSidebar={toggleSidebar}
                setCurrentSection={setCurrentSection} // Added to handle sidebar navigation
                currentSection={currentSection}
            />
            {!isSidebarOpen && (
                <button
                    onClick={toggleSidebar}
                    className="fixed top-1/2 left-1 z-50 transform -translate-y-1/2 flex flex-col space-y-1 md:hidden"
                >
                    <ChevronRightIcon className="h-6 w-6" />
                </button>
            )}

            <div className="relative w-full h-full overflow-hidden">
                <div
                    className="flex h-full w-full transition-transform duration-700 ease-in-out"
                    style={{
                        transform: `translateX(-${currentSection * 100}%)`,
                    }}
                >
                    <div className="flex-shrink-0 w-full h-full">
                        <DeviceInfo
                            data={deviceInfoData}
                            setData={setDeviceInfoData}
                            onNext={handleNext}
                            onSkip={handleSkip}
                        />
                    </div>
                    <div className="flex-shrink-0 w-full h-full">
                        <MapInfo
                            data={mapInfoData}
                            setData={setMapInfoData}
                            onNext={handleNext}
                            onSkip={handleSkip}
                        />
                    </div>
                    <div className="flex-shrink-0 w-full h-full">
                        <Stake
                            data={stakeData}
                            setData={setStakeData}
                            onNext={handleNext}
                            onSkip={handleSkip}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};
