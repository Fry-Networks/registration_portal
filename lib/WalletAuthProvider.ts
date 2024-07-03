import { Provider } from "next-auth/providers";
import { verifySignature } from "./auth";

export default function WalletAuthProvider(): Provider {
  return {
    id: "wallet",
    name: "Wallet",
    type: "credentials",
    credentials: {
      address: { label: "Address", type: "text" },
      signature: { label: "Signature", type: "text" },
      nonce: { label: "Nonce", type: "text" },
    },
    authorize: async (credentials) => {
      if (!credentials?.address || !credentials?.signature || !credentials?.nonce) {
        return null;
      }

      const isValid = await verifySignature(
        credentials.address,
        credentials.signature,
        credentials.nonce
      );

      if (isValid) {
        return { id: credentials.address, address: credentials.address };
      }

      return null;
    },
  };
}