import { useState } from 'react';
import { useRouter } from 'next/router';
import Sidebar from './Sidebar';
import bgImg from '../assets/background.png';
import { useSession } from 'next-auth/react';
import SectionBanner from './SectionBanner';

const DeviceInfo = ({ minerKey, data, setData, onNext, onSkip, onCancel, status }) => {
  const router = useRouter();
  const [errors, setErrors] = useState<{ [key: string]: string }>({});
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const { data: session } = useSession();

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
    if (!validateForm()) return;
    if (!session || !session.user) return;
    onNext();
  };

  const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);

  return (
    <div className="flex h-full">
      <div className="flex flex-col w-full relative">
        <SectionBanner
          image={bgImg}
          title="Device Information"
          subtitle="Tell us about the device owner. You can edit this later."
          height={240}
          darkOverlay={0.45}
        />

        <div className="py-8 pl-8 pr-24 md:px-24 h-full relative">
          <form className="w-full text-black">
            <div>
              <label className="block mb-2 text-white">
                Email <span className="text-red-500">*</span>
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
              <label className="block mb-2 mt-2 text-white">
                First Name <span className="text-red-500">*</span>
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
              <label className="block mb-2 mt-2 text-white">
                Last Name <span className="text-red-500">*</span>
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
              <label className="block mb-2 mt-2 text-white">Nickname</label>
              <input
                type="text"
                className="w-full p-2 border border-red-600 rounded"
                placeholder="Enter Nickname"
                value={data.nickname}
                onChange={(e) => setData({ ...data, nickname: e.target.value })}
              />
            </div>
          </form>

          <div className="absolute bottom-4 right-4 flex gap-2 text-white">
            <button
              type="button"
              className="px-4 py-2 border border-gray-500 rounded hover:bg-gray-500"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="px-4 py-2 border border-gray-500 rounded hover:bg-gray-500"
              onClick={onSkip}
            >
              Back
            </button>
            <button
              type="button"
              className="px-4 py-2 border border-red-600 rounded hover:bg-red-600"
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
