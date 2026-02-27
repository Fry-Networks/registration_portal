// Dedicated Mongo client for the post-cutoff rewards database (dbrewards).
import { MongoClient } from 'mongodb';
import dns from 'dns';

declare global {
  // Preserve the rewards client across HMR in development.
  // eslint-disable-next-line no-var
  var _mongoRewardsClientPromise: Promise<MongoClient> | undefined;
}

// Prefer IPv4 for SRV lookups to avoid IPv6 resolution failures in some envs.
try {
  if (typeof dns.setDefaultResultOrder === 'function') {
    dns.setDefaultResultOrder('ipv4first');
  }
} catch {
  // Ignore when setDefaultResultOrder is unavailable in older Node versions.
}

if (!process.env.MONGO_REWARDS_URI) {
  throw new Error('Invalid/Missing environment variable: "MONGO_REWARDS_URI"');
}

const uri = process.env.MONGO_REWARDS_URI;
const options = {
  // Intentionally empty; keep options explicit for auditability.
};

let client: MongoClient;
let clientPromise: Promise<MongoClient>;

if (process.env.NODE_ENV === 'development') {
  if (!global._mongoRewardsClientPromise) {
    client = new MongoClient(uri, options);
    global._mongoRewardsClientPromise = client.connect();
  }
  clientPromise = global._mongoRewardsClientPromise;
} else {
  client = new MongoClient(uri, options);
  clientPromise = client.connect();
}

export default clientPromise;
