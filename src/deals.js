const STEAM_FEATURED_CATEGORIES_URL = 'https://store.steampowered.com/api/featuredcategories';
const STEAM_SEARCH_RESULTS_URL = 'https://store.steampowered.com/search/results/';
const EPIC_FREE_GAMES_URL = 'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions';
const STEAM_SEARCH_PAGE_SIZE = 100;
const STEAM_SEARCH_MAX_PAGES = 3;

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

function decodeHtml(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

function stripHtml(value) {
  return decodeHtml(value.replace(/<[^>]*>/g, '').trim());
}

function parseSteamSearchResults(html) {
  const rows = html.match(/<a\b[^>]*class="[^"]*\bsearch_result_row\b[^"]*"[\s\S]*?<\/a>/g) ?? [];

  return rows
    .map((row) => {
      const appId = row.match(/data-ds-appid="(\d+)"/)?.[1];
      const title = row.match(/<span class="title">([\s\S]*?)<\/span>/)?.[1];
      const rowText = stripHtml(row);
      const isFullDiscount = /-\s*100%/.test(rowText);
      const isFree = /\bfree\b/i.test(rowText) || /0[,.\s]*00/.test(rowText);

      if (!appId || !title || !isFullDiscount || !isFree) {
        return null;
      }

      return {
        id: `steam:${appId}`,
        platform: 'Steam',
        name: stripHtml(title),
        url: `https://store.steampowered.com/app/${appId}`,
        originalPrice: null,
        finalPrice: 0
      };
    })
    .filter(Boolean);
}

async function getSteamFeaturedFreeDeals({ country = 'SK', locale = 'sk-SK' } = {}) {
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

async function getSteamSearchFreeDeals({ country = 'SK', locale = 'sk-SK' } = {}) {
  const language = locale.split('-')[0] || 'english';
  const deals = [];

  for (let page = 0; page < STEAM_SEARCH_MAX_PAGES; page += 1) {
    const url = buildUrl(STEAM_SEARCH_RESULTS_URL, {
      query: '',
      start: page * STEAM_SEARCH_PAGE_SIZE,
      count: STEAM_SEARCH_PAGE_SIZE,
      dynamic_data: '',
      sort_by: 'Price_ASC',
      specials: 1,
      infinite: 1,
      cc: country,
      l: language
    });

    const data = await fetchJson(url);
    const pageDeals = parseSteamSearchResults(data?.results_html ?? '');
    deals.push(...pageDeals);

    if (!data?.results_html || (data.total_count && (page + 1) * STEAM_SEARCH_PAGE_SIZE >= data.total_count)) {
      break;
    }
  }

  return deals;
}

export async function getSteamFreeDeals(options = {}) {
  const results = await Promise.allSettled([
    getSteamFeaturedFreeDeals(options),
    getSteamSearchFreeDeals(options)
  ]);

  const deals = new Map();
  const errors = [];

  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const deal of result.value) {
        deals.set(deal.id, deal);
      }
    } else {
      errors.push(result.reason);
    }
  }

  if (errors.length === results.length) {
    throw errors[0];
  }

  for (const error of errors) {
    console.warn(error);
  }

  return [...deals.values()];
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
