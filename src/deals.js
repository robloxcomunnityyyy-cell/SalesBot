const STEAM_FEATURED_CATEGORIES_URL = 'https://store.steampowered.com/api/featuredcategories';
const EPIC_FREE_GAMES_URL = 'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions';

function buildUrl(baseUrl, params) {
  const url = new URL(baseUrl);

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  }

  return url;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'accept': 'application/json',
      'user-agent': 'discord-free-games-bot/1.0'
    }
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${url}`);
  }

  return response.json();
}

export async function getSteamFreeDeals({ country = 'SK', locale = 'sk-SK' } = {}) {
  const language = locale.split('-')[0] || 'english';
  const url = buildUrl(STEAM_FEATURED_CATEGORIES_URL, {
    cc: country,
    l: language
  });

  const data = await fetchJson(url);
  const items = data?.specials?.items ?? [];

  return items
    .filter((item) => item?.id && item?.discount_percent === 100 && item?.final_price === 0)
    .map((item) => ({
      id: `steam:${item.id}`,
      platform: 'Steam',
      name: item.name,
      url: `https://store.steampowered.com/app/${item.id}`,
      originalPrice: item.original_price,
      finalPrice: item.final_price
    }));
}

function isActivePromotion(offer, now = new Date()) {
  const start = offer?.startDate ? new Date(offer.startDate) : null;
  const end = offer?.endDate ? new Date(offer.endDate) : null;

  return start instanceof Date
    && end instanceof Date
    && !Number.isNaN(start.valueOf())
    && !Number.isNaN(end.valueOf())
    && start <= now
    && now <= end;
}

function getEpicUrl(game) {
  const mappingSlug = game?.catalogNs?.mappings?.find((mapping) => mapping?.pageSlug)?.pageSlug;
  const slug = game?.productSlug || mappingSlug;

  if (slug) {
    return `https://store.epicgames.com/p/${slug}`;
  }

  return 'https://store.epicgames.com/free-games';
}

export async function getEpicFreeDeals({ country = 'SK', locale = 'sk-SK' } = {}) {
  const url = buildUrl(EPIC_FREE_GAMES_URL, {
    locale,
    country,
    allowCountries: country
  });

  const data = await fetchJson(url);
  const games = data?.data?.Catalog?.searchStore?.elements ?? [];
  const now = new Date();

  return games
    .filter((game) => {
      const offers = game?.promotions?.promotionalOffers?.flatMap((entry) => entry.promotionalOffers ?? []) ?? [];
      const hasActiveFreePromotion = offers.some((offer) => isActivePromotion(offer, now));
      const discountPrice = game?.price?.totalPrice?.discountPrice;

      return game?.id && game?.title && hasActiveFreePromotion && discountPrice === 0;
    })
    .map((game) => ({
      id: `epic:${game.id}`,
      platform: 'Epic Games',
      name: game.title,
      url: getEpicUrl(game),
      originalPrice: game?.price?.totalPrice?.originalPrice,
      finalPrice: game?.price?.totalPrice?.discountPrice
    }));
}

export async function getAllFreeDeals(options = {}) {
  const {
    country = 'SK',
    steamCountry = country,
    epicCountry = country,
    locale = 'sk-SK'
  } = options;

  const results = await Promise.allSettled([
    getSteamFreeDeals({ country: steamCountry, locale }),
    getEpicFreeDeals({ country: epicCountry, locale })
  ]);

  const deals = [];
  const errors = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      deals.push(...result.value);
    } else {
      errors.push(result.reason);
    }
  }

  return { deals, errors };
}
