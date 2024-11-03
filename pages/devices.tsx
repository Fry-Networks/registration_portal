import { useEffect, useState } from 'react';
import { UserIcon, UserAddIcon, UserRemoveIcon } from '@heroicons/react/outline';
import { useRouter } from 'next/router';

type Device = {
    _id: string;
    email: string;
    firstName: string;
    lastName: string;
    nickname: string;
    longitude: string;
    latitude: string;
    status: 'registered' | 'unregistered';
    wallet: string;
};

const devices: Device[] = [{
    _id: "123",
    email: "123",
    firstName: "123",
    lastName: "123",
    nickname: "123",
    longitude: "123",
    latitude: "123",
    status: 'registered',
    wallet: "123",
},
{
    _id: "456",
    email: "456",
    firstName: "456",
    lastName: "456",
    nickname: "456",
    longitude: "456",
    latitude: "456",
    status: 'unregistered',
    wallet: "456",
}
];

const DevicesPage = () => {
    const router = useRouter();
    // const [devices, setDevices] = useState<Device[]>([]);
    const [view, setView] = useState<'devices' | 'verified'>('devices'); // State to toggle between views

    // useEffect(() => {
    //     // Fetch device data from the backend
    //     const fetchDevices = async () => {
    //         const response = await fetch('/api/devices');
    //         const data = await response.json();
    //         setDevices(data);
    //     };
    //     fetchDevices();
    // }, []);

    const handleAdd = () => {
        // Redirect to the register page to add a new device
        router.push('/register');
    };

    const handleDelete = async (id: string) => {
        // Send a request to delete the device from the backend
        try {
            const response = await fetch(`/api/devices/${id}`, {
                method: 'DELETE',
            });
            if (response.ok) {
                // Remove the deleted device from the local state
                // setDevices((prevDevices) => prevDevices.filter((device) => device._id !== id));
                console.log("Device deleted successfully");
            } else {
                console.error("Failed to delete device");
            }
        } catch (error) {
            console.error("Error deleting device:", error);
        }
    };

    const handleChange = (id: string) => {
        // Redirect to an edit page where the device details can be modified
        router.push(`/edit-device/${id}`);
    };

    return (
        <div className="min-h-screen p-8">
            {/* Top buttons to toggle between Devices and Verified views */}
            <div className="flex justify-between m-6 text-4xl">
                <button
                    onClick={() => setView('devices')}
                    className={`${view === 'devices' ? 'text-red-500' : 'text-white'}`}
                >
                    Devices
                </button>
                <button
                    onClick={() => setView('verified')}
                    className={`${view === 'verified' ? 'text-red-500' : 'text-white'}`}
                >
                    Verified
                </button>
            </div>

            {/* Conditionally render content based on selected view */}
            {view === 'devices' ? (
                <div className="grid grid-cols-2 gap-6">
                    {devices.map((device) => (
                        <div
                            key={device._id}
                            className={`p-2 border border-red-600 rounded-lg ${device.status === 'registered' ? 'bg-green-500' : 'bg-red-500'} text-white`}
                        >
                            <div className="flex justify-end space-x-2">
                                <UserAddIcon onClick={handleAdd} className="w-6 h-6 cursor-pointer" />
                                <UserIcon onClick={() => handleChange(device._id)} className="w-6 h-6 cursor-pointer" />
                                <UserRemoveIcon onClick={() => handleDelete(device._id)} className="w-6 h-6 cursor-pointer" />
                            </div>
                            <p><strong>Email:</strong> {device.email}</p>
                            <p><strong>First Name:</strong> {device.firstName}</p>
                            <p><strong>Last Name:</strong> {device.lastName}</p>
                            <p><strong>Nickname:</strong> {device.nickname}</p>
                            <p><strong>Longitude:</strong> {device.longitude}</p>
                            <p><strong>Latitude:</strong> {device.latitude}</p>
                            <p><strong>Reward Wallet Address:</strong> {device.wallet}</p>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="text-center text-xl font-bold">
                    Hello World
                </div>
            )}
        </div>
    );
};

export default DevicesPage;
