import {
  Button,
  Flex,
  Select,
  SelectItem,
  TextInput,
  Title
} from '@tremor/react';
import Image from 'next/image';
import { useRouter } from 'next/router';

import bgImg from '../assets/background.png';
import MessageUpdate from '../components/messageUpdate';
import { useEffect, useState } from 'react';
import { getSession, useSession } from 'next-auth/react';
import clientPromise from '../lib/mongoclient';
import { useDevWallet } from '../hooks/UseDevWallet';
import Link from 'next/link';
import { Product } from '../lib/types';
import { useToastContext } from '../hooks/ToastContext';

const minerType = {
  weather: ['HWM', 'LWM'],
  air: ['IHAQM', 'ILAQM', 'OMAQM', 'IMAQM', 'OHAQM'],
  water: ['OLWQM', 'OHWQM'],
  radiation: ['IRM'],
  hardware: ['ISM', 'OSM', 'BM', 'IDM', 'ODM'],
  camera: [
    'AOWSCM',
    'AOWCM',
    'AIWCM',
    'AOSCM',
    'AISCM',
    'AOTCM',
    'AITCM',
    'AIWSCM'
  ],
  energy: ['EM'],
  node: ['SDN', 'SVN', 'RDN', 'CN', 'AEM']
};

type MinerCategory = keyof typeof minerType;
type MinerType = (typeof minerType)[MinerCategory][number];

export default function Convert({ products }: { products: Product[] }) {
  const [byodLicense, setByodLicense] = useState('');
  const [selectedProduct, setSelectedProduct] = useState('');
  const [miner_key, setMinerKey] = useState('');
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const { devAccount } = useDevWallet();
  const { data: session } = useSession();
  const toast = useToastContext();
  const router = useRouter();

  const isAllowed = (key: string) => {
    if (
      [
        'OLWQM',
        'OHWQM',
        'EM',
        'RDN',
        'IRM',
        'SVN',
        'SDN',
        'CN',
        'OAHAQM',
        'OTHAQM',
        'IHAQM'
      ].includes(key)
    ) {
      return false;
    }

    return true;
  };

  function getMinerCategory(miner_key: string): MinerCategory | null {
    const prefix = miner_key.split('-')[0];
    for (const key of Object.keys(minerType) as MinerCategory[]) {
      if (minerType[key].includes(prefix)) {
        return key;
      }
    }
    return null;
  }

  useEffect(() => {
    if (!products || products.length < 0) {
      return;
    }
    const tempProducts = products.filter((product) => isAllowed(product.key));
    if (tempProducts.length <= 0) {
      return;
    }

    setSelectedProduct(tempProducts[0].key);
    setFilteredProducts(tempProducts);
  }, [products]);

  const handleConvert = async () => {
    const address = session?.user.address;

    console.log(
      `Address: ${address} byod: ${byodLicense} key: ${selectedProduct}`
    );
    const response = await fetch('/api/convert-byod', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ address, byod: byodLicense, key: selectedProduct })
    });

    const data = await response.json();
    if (response.ok) {
      toast.success({
        heading: 'Convert Success',
        message: 'Converted your byod license to miner key'
      });
      setMinerKey(data.miner_key);
    } else {
      setByodLicense('');
      const message =
        typeof data?.message === 'string'
          ? data.message
          : 'Failed to convert BYOD license to miner key';
      toast.error({
        heading: 'Convert Error',
        message
      });
    }
  };

  const handleRegister = async (minerKey: string): Promise<void> => {
    try {
      const response = await fetch(`/api/devices/${minerKey}`);
      if (!response.ok) {
        toast.error({ heading: 'Error', message: 'Device not found' });
        return;
      }

      const result = await response.json();
      if (result.device.is_registered) {
        toast.error({ heading: 'Error', message: 'Already registered' });
        return;
      }

      const prefix = getMinerCategory(minerKey);
      if (!prefix) {
        toast.error({
          heading: 'Error',
          message: `Invalid Miner Key! We couldn't validate that miner key. Please double-check it and try again.`
        });
        return;
      }

      // Redirect to the registration credentials step (index 1) instead of old portal pages
      if (result.device.registered_portal_model !== undefined) {
        router.push({
          pathname: '/register',
          query: { minerKey, type: result.device.registered_portal_model, index: '0' }
        });
        return;
      }

      router.push({
        pathname: '/register',
        query: { minerKey, type: prefix, index: '0' }
      });
    } catch (error) {
      toast.error({
        heading: 'Error',
        message:
          'There is an error occured for registering. Please contact us before you try again'
      });
      return;
    }
  };

  return (
    <div className="w-full">
      <div className="relative flex mb-10">
        <Image
          src={bgImg}
          className="w-full h-[40vh] object-cover"
          alt="Background Image"
        />
        <Flex
          flexDirection="col"
          className="absolute w-full h-full justify-center gap-6"
        >
          <Title
            className="text-white text-4xl sm:text-5xl text-center"
            key="title"
          >
            Convert BYOD License to Miner Key
          </Title>
        </Flex>
      </div>

      <Flex flexDirection="col" className="px-4 sm:px-20 ">
        <div className="w-full mt-5" key={`input`}>
          <TextInput
            type="text"
            value={byodLicense}
            onChange={(e) => setByodLicense(e.target.value)}
            placeholder="Enter your byod license"
            className="mt-2 mb-2"
            error={byodLicense !=="" && !/^[A-Z0-9]+$/.test(byodLicense)}
            errorMessage="Invalid byod license"
          />
        </div>

        <Select
          defaultValue="1"
          value={selectedProduct}
          onValueChange={setSelectedProduct}
          className="mb-10"
          key="type"
          placeholder="Select an miner type"
        >
          {filteredProducts.length > 0 &&
            filteredProducts.map((product, index) => (
              <SelectItem key={index} value={product.key}>
                {product.name}
              </SelectItem>
            ))}
        </Select>

        <Flex flexDirection="row" justifyContent="center" className="gap-3">
          <Link href="/devices">
            <Button className="bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600">
              {`< Back`}
            </Button>
          </Link>

          <Button
            className="bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600"
            onClick={handleConvert}
            disabled={
              byodLicense === '' ||
              selectedProduct === '' ||
              !/^[A-Z0-9]+$/.test(byodLicense)
            }
          >
            Convert
          </Button>
          <Button
            className="bg-transparent border-red-600 hover:bg-red-600 hover:border-red-600"
            onClick={() => handleRegister(miner_key)}
            disabled={
              miner_key === ''
            }
          >
            {`Add >`}
          </Button>
        </Flex>

        {miner_key && <p className="mt-2">Your miner key is: {miner_key}</p>}
      </Flex>
    </div>
  );
}

export async function getServerSideProps(context: any) {
  const session = await getSession(context);
  if (!session || !session.user.address) {
    return { props: {} };
  }

  try {
    const client = await clientPromise;
    const db = client.db('main');

    const products = await db.collection('products').find({}).toArray();

    if (!products) {
      return {
        props: {
          products: []
        }
      };
    } else {
      return {
        props: {
          products: JSON.parse(
            JSON.stringify(
              products.map((product) => {
                return {
                  name: product.name,
                  key: product.key
                };
              })
            )
          )
        }
      };
    }
  } catch (error) {
    console.error(error);
    return {
      props: {}
    };
  }
}
