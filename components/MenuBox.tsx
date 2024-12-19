import { Menu, MenuButton, MenuItem, MenuItems } from '@headlessui/react'
import { UserCircleIcon, LogoutIcon } from "@heroicons/react/outline";




export default function DownMenu({ address, disconnect }) {
  return (
    <Menu as="div" className="relative inline-block text-left">
      <div>
        <MenuButton className="inline-flex w-full justify-center gap-x-1.5 rounded-md bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600 px-3 py-2 text-sm font-semibold text-white ring-1 ring-inset ring-red-600">
          {address}
        </MenuButton>
      </div>
      <MenuItems
        transition
        className="absolute right-0 z-10 mt-2 w-56 origin-top-right rounded-md bg-white shadow-lg ring-1 ring-black/5 transition focus:outline-none data-[closed]:scale-95 data-[closed]:transform data-[closed]:opacity-0 data-[enter]:duration-100 data-[leave]:duration-75 data-[enter]:ease-out data-[leave]:ease-in"
      >
        <div className="py-1">
          <MenuItem>
              <a
                href="#"
                className="block px-2 py-2 text-sm text-gray-900 data-[focus]:bg-gray-100 data-[focus]:text-gray-900 data-[focus]:outline-none"
              >
                <div className='flex items-center px-2 gap-2'>
                  <UserCircleIcon className="h-6 w-6 text-gray-900" />
                  Edit Profile
                </div>
              </a>
          </MenuItem>
          <MenuItem>
              <a
                onClick={disconnect}
                className="block px-2 py-2 text-sm text-gray-900 data-[focus]:bg-gray-100 data-[focus]:text-gray-900 data-[focus]:outline-none cursor-pointer"
              >
                <div className='flex items-center px-2 gap-2'>
                  <LogoutIcon className="h-6 w-6 text-gray-900" />
                  Disconnect
                </div>
              </a>
          </MenuItem>
          {/* <form action="#" method="POST">
            <MenuItem>
              <button
                type="submit"
                className="block w-full px-4 py-2 text-left text-sm text-gray-700 data-[focus]:bg-gray-100 data-[focus]:text-gray-900 data-[focus]:outline-none"
              >
                Sign out
              </button>
            </MenuItem>
          </form> */}
        </div>
      </MenuItems>
    </Menu>
  )
}