import { ChevronLeftIcon, CheckIcon } from '@heroicons/react/outline';

interface SidebarProps {
  completionStatus: {
    device: boolean;
    wallet: boolean;
    map: boolean;
    stake: boolean;
  };
  isOpen: boolean;
  toggleSidebar: () => void;
  setCurrentSection: (section: number) => void;
  currentSection: number; // Add currentSection prop to keep track of active section
}

export default ({
  completionStatus,
  isOpen,
  toggleSidebar,
  setCurrentSection,
  currentSection
}: SidebarProps) => {
  return (
    <div
      className={`fixed top-0 left-0 z-50 h-full w-64 bg-gray-950 md:bg-transparent border-r border-white/10 p-4 text-white transform ${
        isOpen ? 'translate-x-0' : '-translate-x-full'
      } transition-transform duration-300 md:relative md:translate-x-0 md:w-1/5`}
    >
      {isOpen && (
        <button
          onClick={toggleSidebar}
          className="fixed top-1/2 left-56 z-50 transform -translate-y-1/2 flex flex-col space-y-1 md:hidden"
        >
          <ChevronLeftIcon className="h-6 w-6" />
        </button>
      )}
      <div
        onClick={() => {
          setCurrentSection(0);
          toggleSidebar();
        }}
        className={`flex items-center cursor-pointer mb-4 mt-16 ${currentSection === 0 ? 'bg-gray-800 p-2 rounded' : ''}`}
      >
        <span className="mr-2">
          {completionStatus.device ? (
            <CheckIcon className="h-5 w-5 text-green-500" /> // Display check icon if complete
          ) : (
            <span className="text-red-500">&#9679;</span> // Display red dot if incomplete
          )}
        </span>
        Device Information
      </div>
      <div
        onClick={() => {
          setCurrentSection(1);
          toggleSidebar();
        }}
        className={`flex items-center cursor-pointer mb-4 ${currentSection === 1 ? 'bg-gray-800 p-2 rounded' : ''}`}
      >
        <span className="mr-2">
          {completionStatus.map ? (
            <CheckIcon className="h-5 w-5 text-green-500" /> // Display check icon if complete
          ) : (
            <span className="text-red-500">&#9679;</span> // Display red dot if incomplete
          )}
        </span>
        Wallet Information
      </div>
      <div
        onClick={() => {
          setCurrentSection(2);
          toggleSidebar();
        }}
        className={`flex items-center cursor-pointer mb-4 ${currentSection === 2 ? 'bg-gray-800 p-2 rounded' : ''}`}
      >
        <span className="mr-2">
          {completionStatus.map ? (
            <CheckIcon className="h-5 w-5 text-green-500" /> // Display check icon if complete
          ) : (
            <span className="text-red-500">&#9679;</span> // Display red dot if incomplete
          )}
        </span>
        Map Information
      </div>
      <div
        onClick={() => {
          setCurrentSection(3);
          toggleSidebar();
        }}
        className={`flex items-center cursor-pointer ${currentSection === 3 ? 'bg-gray-800 p-2 rounded' : ''}`}
      >
        <span className="mr-2">
          {completionStatus.stake ? (
            <CheckIcon className="h-5 w-5 text-green-500" /> // Display check icon if complete
          ) : (
            <span className="text-red-500">&#9679;</span> // Display red dot if incomplete
          )}
        </span>
        Stake
      </div>
    </div>
  );
};
