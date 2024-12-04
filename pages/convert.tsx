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
import { Product } from './api/stake/verify-stake';
import { useDevWallet } from '../hooks/UseDevWallet';
import Link from 'next/link';

export default function Convert({ products }: { products: Product[] }) {
  const [byodLicense, setByodLicense] = useState('');
  const [selectedProduct, setSelectedProduct] = useState('');
  const [miner_key, setMinerKey] = useState('');
  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);
  const { devAccount } = useDevWallet();
  const { data: session } = useSession();
  const [updateSuccess, setUpdateSuccess] = useState({
    status: 'success',
    message: ''
  });

  const isAllowed = (key: string) => {
    if (['OLWQM', 'OHWQM', 'EM', 'RDN', 'IRM', 'SVN', 'CN'].includes(key)) {
      return false;
    }

    return true;
  };

  useEffect(() => {
    if (!products || products.length < 0) {
      return;
    }
    const tempProducts = products.filter((product) => isAllowed(product.key));
    if (tempProducts.length <= 0) {
      return;
    }

    console.log(tempProducts[0].name);

    setSelectedProduct(tempProducts[0].key);
    setFilteredProducts(tempProducts);
  }, [products]);

  const handleConvert = async () => {
    const testMode =
      process.env.NEXT_PUBLIC_TEST_MODE &&
      process.env.NEXT_PUBLIC_TEST_MODE === 'true';
    const address = testMode ? devAccount?.addr : session?.user.address;

    console.log(
      `Address: ${address} byod: ${byodLicense} key: ${selectedProduct}`
    );
    const response = await fetch('/api/convert-byod', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ address, byod: byodLicense, key: selectedProduct })
    });

    const data = await response.json();
    if (response.ok) {
      setUpdateSuccess({
        status: 'success',
        message: 'Successfully covnerted your byod license'
      });
      setTimeout(
        () => setUpdateSuccess({ status: 'success', message: '' }),
        15_000
      );
      setMinerKey(data.miner_key);
    } else {
      setByodLicense('');
      setUpdateSuccess({ status: 'error', message: '' });
      setTimeout(
        () => setUpdateSuccess({ status: 'error', message: '' }),
        15_000
      );
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
          <Title className="text-white text-5xl" key="title">
            Convert BYOD License to Miner Key
          </Title>
        </Flex>
      </div>

      <Flex flexDirection="col" className="px-20 ">
        <MessageUpdate updateSuccess={updateSuccess} />
        <div className="w-full mt-5" key={`input`}>
          <TextInput
            type="text"
            value={byodLicense}
            onChange={(e) => setByodLicense(e.target.value)}
            placeholder="Enter your byod license"
            className="mt-2 mb-2"
            error={!/^[A-Z0-9]+$/.test(byodLicense)}
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
              Back
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

    console.log(products);

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
