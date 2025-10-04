import { ChevronLeftIcon, CheckIcon } from '@heroicons/react/outline';

interface SidebarProps {
  completionStatus: {
    credentials: boolean;
    device: boolean;  // used as part of "Personal Information"
    wallet: boolean;  // used as part of "Personal Information"
    map: boolean;     // "Localization"
  };
  isOpen: boolean;
  toggleSidebar: () => void;
  setCurrentSection: (section: number) => void;
  currentSection: number;
  portalTitle?: string | null;
}

const Sidebar = ({
  completionStatus,
  isOpen,
  toggleSidebar,
  setCurrentSection,
  currentSection,
  portalTitle
}: SidebarProps) => {
  const personalComplete = completionStatus.device && completionStatus.wallet;

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
      {/* portalTitle intentionally not shown in sidebar (display in main content instead) */}

      {/* 0 - Credentials */}
      <div
        onClick={() => {
          // You can always go back to Credentials
          setCurrentSection(0);
          toggleSidebar();
        }}
        className={`flex items-center cursor-pointer mb-4 ${currentSection === 0 ? 'bg-gray-800 p-2 rounded' : ''}`}
      >
        <span className="mr-2">
          {completionStatus.credentials ? (
            <CheckIcon className="h-5 w-5 text-green-500" />
          ) : (
            <span className="text-red-500">&#9679;</span>
          )}
        </span>
        Credentials
      </div>

      {/* 1 - Personal Information (Device + Wallet combined) */}
      <div
        onClick={() => {
          // Allow if credentials are done OR personal already done
          if (completionStatus.credentials || personalComplete) {
            setCurrentSection(1);
          }
          toggleSidebar();
        }}
        className={`flex items-center cursor-pointer mb-4 ${currentSection === 1 ? 'bg-gray-800 p-2 rounded' : ''}`}
      >
        <span className="mr-2">
          {personalComplete ? (
            <CheckIcon className="h-5 w-5 text-green-500" />
          ) : (
            <span className="text-red-500">&#9679;</span>
          )}
        </span>
        Personal Information
      </div>

      {/* 2 - Localization */}
      <div
        onClick={() => {
          // Allow if localization complete OR (credentials + personal complete)
          if (completionStatus.map || (completionStatus.credentials && personalComplete)) {
            setCurrentSection(2);
          }
          toggleSidebar();
        }}
        className={`flex items-center cursor-pointer mb-4 ${currentSection === 2 ? 'bg-gray-800 p-2 rounded' : ''}`}
      >
        <span className="mr-2">
          {completionStatus.map ? (
            <CheckIcon className="h-5 w-5 text-green-500" />
          ) : (
            <span className="text-red-500">&#9679;</span>
          )}
        </span>
        Localization
      </div>
    </div>
  );
};

Sidebar.displayName = 'Sidebar';

export default Sidebar;
