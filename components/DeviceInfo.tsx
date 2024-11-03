import { useState } from 'react';
import { useRouter } from 'next/router';
import Sidebar from './Sidebar'; // Ensure this component is properly imported
import bgImg from '../assets/background.png';
import Image from 'next/image';

const DeviceInfo = ({ data, setData, onNext, onSkip }) => {
  const router = useRouter();
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [isComplete, setIsComplete] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const validateForm = () => {
    const newErrors: { [key: string]: string } = {};
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(data.email)) newErrors.email = 'Invalid email address';
    if (!data.firstName) newErrors.firstName = 'First name is required';
    if (!data.lastName) newErrors.lastName = 'Last name is required';

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (validateForm()) {
      await fetch('/api/saveDeviceInfo', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      setIsComplete(true);
      onNext(); // Call the onNext function to navigate to the next section
    }
  };

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen);
  };

  return (
    <div className="flex h-full">
      <div className="flex flex-col w-full relative">
        <Image
          src={bgImg}
          className="w-screen h-[30vh] object-cover"
          alt="Background Image"
        />
        <div className="py-8 px-16 md:px-24 h-full relative">
          <form className="w-full">
            <div>
              <label className="block mb-2">Email{" "}
                <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                className="w-full p-2 border border-red-600 rounded"
                placeholder="Enter Email Address"
                value={data.email}
                onChange={(e) => setData({ ...data, email: e.target.value })}
              />
              {errors.email && <span className="text-red-500 text-sm">{errors.email}</span>}
            </div>
            <div>
              <label className="block mb-2 mt-2">First Name{" "}
                <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                className="w-full p-2 border border-red-600 rounded"
                placeholder="Enter First Name"
                value={data.firstName}
                onChange={(e) => setData({ ...data, firstName: e.target.value })}
              />
              {errors.firstName && <span className="text-red-500 text-sm">{errors.firstName}</span>}
            </div>
            <div>
              <label className="block mb-2 mt-2">Last Name{" "}
                <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                className="w-full p-2 border border-red-600 rounded"
                placeholder="Enter Last Name"
                value={data.lastName}
                onChange={(e) => setData({ ...data, lastName: e.target.value })}
              />
              {errors.lastName && <span className="text-red-500 text-sm">{errors.lastName}</span>}
            </div>
            <div>
              <label className="block mb-2 mt-2">Nickname</label>
              <input
                type="text"
                className="w-full p-2 border border-red-600 rounded"
                placeholder="Enter Nickname"
                value={data.nickname}
                onChange={(e) => setData({ ...data, nickname: e.target.value })}
              />
            </div>
          </form>
          <div className="absolute bottom-4 right-4 flex gap-2">
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

export default DeviceInfo;
