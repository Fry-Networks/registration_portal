import { ChevronLeftIcon, CheckIcon } from '@heroicons/react/outline';
import { useTheme } from 'next-themes';

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
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme !== 'light';

  const containerBase =
    'fixed top-0 left-0 z-50 h-full w-64 p-4 transform transition-transform duration-300 md:relative md:translate-x-0 md:w-1/5';
  const containerTheme = isDark
    ? 'bg-gray-950 text-white border-r border-white/10'
    : 'bg-gradient-to-b from-slate-50 via-slate-100 to-white text-slate-900 border-r border-slate-200 shadow-[0_10px_30px_rgba(15,23,42,0.08)] md:shadow-none md:border-0 md:bg-transparent';
  const itemBase =
    'flex items-center gap-2 cursor-pointer mb-4 rounded-lg border transition focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400';
  const itemState = (active: boolean) =>
    active
      ? isDark
        ? 'border-red-400/80 bg-red-500/15 text-white shadow-md'
        : 'border-red-400 bg-transparent text-slate-900'
      : isDark
        ? 'border-white/10 bg-transparent hover:border-red-400/60 hover:bg-gray-900/60'
        : 'border-transparent bg-transparent hover:border-red-300 hover:bg-red-50/50';
  const dotClass = isDark ? 'text-red-500' : 'text-red-600';
  const checkClass = isDark ? 'text-green-500' : 'text-emerald-600';

  return (
    <div
      className={`${containerBase} ${containerTheme} ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
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
        className={`${itemBase} ${itemState(currentSection === 0)}`}
      >
        <span className="mr-2">
          {completionStatus.credentials ? (
            <CheckIcon className={`h-5 w-5 ${checkClass}`} />
          ) : (
            <span className={dotClass}>&#9679;</span>
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
        className={`${itemBase} ${itemState(currentSection === 1)}`}
      >
        <span className="mr-2">
          {personalComplete ? (
            <CheckIcon className={`h-5 w-5 ${checkClass}`} />
          ) : (
            <span className={dotClass}>&#9679;</span>
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
        className={`${itemBase} ${itemState(currentSection === 2)}`}
      >
        <span className="mr-2">
          {completionStatus.map ? (
            <CheckIcon className={`h-5 w-5 ${checkClass}`} />
          ) : (
            <span className={dotClass}>&#9679;</span>
          )}
        </span>
        Localization
      </div>
    </div>
  );
};

Sidebar.displayName = 'Sidebar';

export default Sidebar;
