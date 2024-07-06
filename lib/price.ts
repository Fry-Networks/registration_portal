import axios from 'axios';

const FRYVerID = 924268058;
const fryURL = `https://free-api.vestige.fi/asset/${FRYVerID}/price`
const algoURL = "https://free-api.vestige.fi/currency/prices"
let currentFRYPrice = {
    lastFetched: 0,
    price: 0
}
let currentAlgoPrice = {
    lastFetched: 0,
    price: 0
}

export async function getFRYPrice() {
    if (Date.now() - currentFRYPrice.lastFetched > 1000 * 60 * 1) {
        const response = await axios.get(fryURL);
        currentFRYPrice.price = response.data.USD;
        currentFRYPrice.lastFetched = Date.now();
    }
    console.log(currentFRYPrice.price)
    return currentFRYPrice.price;
}
