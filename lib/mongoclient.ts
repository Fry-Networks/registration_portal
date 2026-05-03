// This approach is taken from https://github.com/vercel/next.js/tree/canary/examples/with-mongodb
import { MongoClient } from "mongodb";
import dns from 'dns';

declare global {
  var _mongoClientPromise: Promise<MongoClient>;
}

// Prefer IPv4 when resolving DNS to avoid environments where IPv6 lookups
// cause SRV resolution failures (ESERVFAIL). This is safe to call when the
// Node.js version supports it; wrap in try/catch for older versions.
try {
  if (typeof dns.setDefaultResultOrder === 'function') {
    dns.setDefaultResultOrder('ipv4first');
  }
} catch (e) {
  // ignore if not supported
}

function createClientPromise(): Promise<MongoClient> {
  if (!process.env.MONGO_URI) {
    throw new Error('Invalid/Missing environment variable: "MONGO_URI"');
  }

  const uri = process.env.MONGO_URI;
  const options = {
    // keepAlive: true,
  };

  if (process.env.NODE_ENV === 'development') {
    // In development mode, use a global variable so that the value
    // is preserved across module reloads caused by HMR (Hot Module Replacement).
    if (!global._mongoClientPromise) {
      const client = new MongoClient(uri, options);
      global._mongoClientPromise = client.connect();
    }
    return global._mongoClientPromise;
  } else {
    // In production mode, it's best to not use a global variable.
    const client = new MongoClient(uri, options);
    return client.connect();
  }
}

// Lazy promise: initialization only happens when the promise is awaited/used.
// This prevents module-load-time crashes when MONGO_URI is not available
// during the Next.js build phase.
let _cachedPromise: Promise<MongoClient> | undefined;

const clientPromise: Promise<MongoClient> = {
  then(onfulfilled, onrejected) {
    if (!_cachedPromise) _cachedPromise = createClientPromise();
    return _cachedPromise.then(onfulfilled, onrejected);
  },
  catch(onrejected) {
    if (!_cachedPromise) _cachedPromise = createClientPromise();
    return _cachedPromise.catch(onrejected);
  },
  finally(onfinally) {
    if (!_cachedPromise) _cachedPromise = createClientPromise();
    return _cachedPromise.finally(onfinally);
  },
  [Symbol.toStringTag]: 'Promise',
};

// Export a module-scoped MongoClient promise. By doing this in a
// separate module, the client can be shared across functions.
export default clientPromise;
