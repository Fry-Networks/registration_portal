'use client';

import { Fragment } from 'react';
import { usePathname } from 'next/navigation';
import { Disclosure } from '@headlessui/react';
import { Bars3Icon, XMarkIcon } from '@heroicons/react/24/outline';
import { signIn, signOut, useSession } from 'next-auth/react';
import Image from 'next/image';
import { Button, Flex } from '@tremor/react';
import Link from 'next/link';

import fryLogo from '../assets/Logo.png';

const navigation = [
  { name: 'My registrations', href: '/my_registrations' },
  { name: 'New registration', href: '/new_registration' }
];

function classNames(...classes: string[]) {
  return classes.filter(Boolean).join(' ');
}

export default function Navbar() {
  const pathname = usePathname();
  const { data: session } = useSession();

  return (
    <div>
      <Flex
        flexDirection="row"
        className="w-full px-20 border-b  border-white/10 max-sm:px-0"
      >
        <div className="flex">
          <Link
            href="https://frynetworks.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Image src={fryLogo} className="logo" alt="Fry logo" />
          </Link>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Button className="bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600">
            Connect Wallet
          </Button>
        </div>
      </Flex>
    </div>
  );
}
