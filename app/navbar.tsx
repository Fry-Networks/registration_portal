'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Disclosure } from '@headlessui/react';
// Using @heroicons/react v1 API
import { MenuIcon, XIcon } from '@heroicons/react/outline';
import { signIn, signOut, useSession } from 'next-auth/react';
import Image from 'next/image';
import { Button } from '@tremor/react';

const navigation = [
  { name: 'My registrations', href: '/my_registrations' },
  // 'New registration' removed from top-level nav
];

function classNames(...classes: string[]) {
  return classes.filter(Boolean).join(' ');
}


export default function Navbar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const [countdown, setCountdown] = useState<string>("");

  // Countdown to next Friday 00:05 UTC
  useEffect(() => {
    const getNextFridayUnlockUTC = (now: Date) => {
      const day = now.getUTCDay(); // 0=Sun..5=Fri
      const thisFriday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
      const diffToFriday = (day + 7 - 5) % 7; // days since last Friday
      thisFriday.setUTCDate(thisFriday.getUTCDate() - diffToFriday);
      const thisUnlock = new Date(thisFriday.getTime() + 5 * 60 * 1000);
      if (now.getTime() >= thisUnlock.getTime()) {
        const nextFriday = new Date(thisFriday.getTime() + 7 * 24 * 60 * 60 * 1000);
        return new Date(nextFriday.getTime() + 5 * 60 * 1000);
      }
      return thisUnlock;
    };

    const update = () => {
      const now = new Date();
      const target = getNextFridayUnlockUTC(now);
      const diff = Math.max(0, target.getTime() - now.getTime());
      const days = Math.floor(diff / (24 * 60 * 60 * 1000));
      const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
      const mins = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
      const secs = Math.floor((diff % (60 * 1000)) / 1000);
      setCountdown(`${days}d ${hours}h ${mins}m ${secs}s`);
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, []);

  // Totals ribbon moved to FloatingTotalsWidget on pages; no totals fetch here

  return (
    <Disclosure as="nav" className="bg-white shadow-sm border-b border-gray-400">
      {({ open }) => (
        <>
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="flex h-16 justify-between">
              <div className="flex">
                <button onClick={() => { window.location.href = '/' }}>
                  <div className="flex flex-shrink-0 items-center">
                    <svg
                      width="32"
                      height="32"
                      viewBox="0 0 32 32"
                      fill="none"
                      className="text-gray-100"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <rect
                        width="100%"
                        height="100%"
                        rx="16"
                        fill="currentColor"
                      />
                      <path
                        fillRule="evenodd"
                        clipRule="evenodd"
                        d="M17.6482 10.1305L15.8785 7.02583L7.02979 22.5499H10.5278L17.6482 10.1305ZM19.8798 14.0457L18.11 17.1983L19.394 19.4511H16.8453L15.1056 22.5499H24.7272L19.8798 14.0457Z"
                        fill="black"
                      />
                    </svg>
                  </div>
                </button>
                <div className="hidden sm:-my-px sm:ml-6 sm:flex sm:space-x-8">
                  {navigation.map((item) => (
                    <a
                      key={item.name}
                      href={item.href}
                      className={classNames(
                        pathname === item.href
                          ? 'border-slate-500 text-gray-900'
                          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300',
                        'inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium'
                      )}
                      aria-current={pathname === item.href ? 'page' : undefined}
                    >
                      {item.name}
                    </a>
                  ))}
                </div>
              </div>
              <div className="hidden sm:ml-6 sm:flex sm:items-center gap-3">
                <div className="text-xs text-gray-700 bg-gray-100 px-2 py-1 rounded-md border border-gray-300">
                  <span className="font-semibold">Next FRYday (UTC 00:05):</span>{' '}
                  <span className="tabular-nums">{countdown}</span>
                </div>
                {session ? (
                  <Button
                    color="red"
                    onClick={() => signOut()}
                    className="text-sm font-medium "
                  >
                    Sign out
                  </Button>
                ) : ''}
              </div>
              <div className="-mr-2 flex items-center sm:hidden">
                <Disclosure.Button className="inline-flex items-center justify-center rounded-md bg-white p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2">
                  <span className="sr-only">Open main menu</span>
                  {open ? (
                    <XIcon className="block h-6 w-6" aria-hidden="true" />
                  ) : (
                    <MenuIcon className="block h-6 w-6" aria-hidden="true" />
                  )}
                </Disclosure.Button>
              </div>
            </div>
          </div>

          <Disclosure.Panel className="sm:hidden">
            <div className="space-y-1 pt-2 pb-3">
              {navigation.map((item) => (
                <Disclosure.Button
                  key={item.name}
                  as="a"
                  href={item.href}
                  className={classNames(
                    pathname === item.href
                      ? 'bg-slate-50 border-slate-500 text-slate-700'
                      : 'border-transparent text-gray-600 hover:bg-gray-50 hover:border-gray-300 hover:text-gray-800',
                    'block pl-3 pr-4 py-2 border-l-4 text-base font-medium'
                  )}
                  aria-current={pathname === item.href ? 'page' : undefined}
                >
                  {item.name}
                </Disclosure.Button>
              ))}
            </div>
          </Disclosure.Panel>
        </>
      )}
    </Disclosure>
  );
}
