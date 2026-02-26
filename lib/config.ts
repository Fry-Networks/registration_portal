import clientPromise from './mongoclient';

/**
 * Fetch a config document from the shared `configs` collection in the `main` db.
 * Uses the `name` + `enabled` shape and returns the provided default on errors.
 */
export const getConfigValue = async <T = unknown>(
  name: string,
  defaultValue?: T
): Promise<T | undefined> => {
  try {
    const client = await clientPromise;
    const db = client.db('main');
    const doc = await db.collection('configs').findOne<{ enabled?: T }>({ name });
    if (!doc || typeof doc.enabled === 'undefined') {
      return defaultValue;
    }
    return doc.enabled as T;
  } catch (error) {
    console.warn(`[config] Failed to load name "${name}", using default.`, error);
    return defaultValue;
  }
};

/**
 * Convenience helper for boolean/toggle configs.
 */
export const getConfigFlag = async (name: string, defaultValue = true): Promise<boolean> => {
  const value = await getConfigValue<unknown>(name, defaultValue);
  if (typeof value === 'boolean') return value;
  return defaultValue;
};
