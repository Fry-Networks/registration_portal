
import axios from 'axios';
// Fetch ALGO/USD price from CoinGecko
export const getAlgoUsdPrice = async (): Promise<number> => {
  try {
    const response = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=algorand&vs_currencies=usd');
    const price = response.data?.algorand?.usd;
    if (typeof price === 'number') {
      return price;
    }
    throw new Error('Invalid response from CoinGecko');
  } catch (error) {
    console.error('Error fetching ALGO/USD price from CoinGecko:', error);
    return 0;
  }
};

const FRYVerID = 924268058;
// const fryURL = `https://free-api.vestige.fi/asset/${FRYVerID}/price`;
// const algoURL = 'https://free-api.vestige.fi/currency/prices';`
let currentFRYPrice = {
  lastFetched: 0,
  price: 0
};
let currentAlgoPrice = {
  lastFetched: 0,
  price: 0
};

export const getFRYPrice = async (asset_id: string): Promise<number> => {
  try {
    const fryURL = `https://api.vestigelabs.org/assets/price?asset_ids=${asset_id}`;
    const response = await axios.get(fryURL);
    if (!response.data || response.data.length === 0) {
      console.error(`No data found for asset ID: ${asset_id}`);
      return parseFloat('0.0');
    }
  const algoUsd = await getAlgoUsdPrice();
  const price = parseFloat(response.data[0].price) * algoUsd;
  return parseFloat(price.toFixed(6));
  } catch (error) {
    console.error(`Error fetching price for ${asset_id}:`, error);
    return parseFloat('0.0');
  }
}
