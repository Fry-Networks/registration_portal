import axios from 'axios';

const FRYVerID = 924268058;
const fryURL = `https://free-api.vestige.fi/asset/${FRYVerID}/price`;
const algoURL = 'https://free-api.vestige.fi/currency/prices';
let currentFRYPrice = {
  lastFetched: 0,
  price: 0
};
let currentAlgoPrice = {
  lastFetched: 0,
  price: 0
};

export async function getFRYPrice(asset_id: string) {
  try {
    const fryURL = `https://free-api.vestige.fi/asset/${asset_id}/price`;
    const response = await axios.get(fryURL);
    return parseFloat(response.data.USD).toFixed(5);
  } catch (error) {
    console.error(`Error fetching price for ${asset_id}:`, error);
    return [];
  }
}
