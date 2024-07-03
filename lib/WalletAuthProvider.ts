import { Provider } from "next-auth/providers";
import { verifySignature } from "./auth";

export default function WalletAuthProvider(): Provider {
  return {
    id: "wallet",
    name: "Wallet",
    type: "credentials",
    credentials: {
      address: { label: "Address", type: "text" },
      signedTxn: { label: "Signature", type: "text" },
      nonce: { label: "Nonce", type: "text" },
    },
    authorize: async (credentials) => {
      console.log(credentials);
      if (!credentials?.address || !credentials?.signedTxn || !credentials?.nonce) {
        console.error('Missing credentials');
        return null;
      }

      const isValid = await verifySignature(
        credentials.address,
        credentials.signedTxn,
        credentials.nonce
      );
      console.log('isValid', isValid);
      if (isValid) {
        return { id: credentials.address, address: credentials.address };
      }

      return null;
    },
  };
}