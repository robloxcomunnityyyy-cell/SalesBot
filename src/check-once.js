import 'dotenv/config.js';
import { getAllFreeDeals } from './deals.js';

const country = process.env.STEAM_COUNTRY ?? process.env.EPIC_COUNTRY ?? 'SK';
const steamCountry = process.env.STEAM_COUNTRY ?? country;
const epicCountry = process.env.EPIC_COUNTRY ?? country;
const locale = process.env.LOCALE ?? 'sk-SK';

const { deals, errors } = await getAllFreeDeals({
  country,
  steamCountry,
  epicCountry,
  locale
});

for (const error of errors) {
  console.warn(error);
}

if (deals.length === 0) {
  console.log('No 100% free games found right now.');
} else {
  for (const deal of deals) {
    console.log(`${deal.platform}: ${deal.name}`);
    console.log(deal.url);
  }
}
