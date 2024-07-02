import {

  Title,
} from '@tremor/react';
import ConnectMenu from '../components/connect';
export default function IndexPage() {


  return (
    <main className="p-4 md:p-10 mx-auto max-w-7xl">
      <Title className='mb-20' >Official DAO Platform of the FRY Foundation</Title>

      <ConnectMenu />
    </main>
  );
}
