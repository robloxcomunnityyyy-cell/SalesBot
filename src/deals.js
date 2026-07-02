const STEAM_FEATURED_CATEGORIES_URL = 'https://store.steampowered.com/api/featuredcategories';
const STEAM_SEARCH_RESULTS_URL = 'https://store.steampowered.com/search/results/';
const EPIC_FREE_GAMES_URL = 'https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions';
const ITAD_DEALS_URL = 'https://api.isthereanydeal.com/deals/v2';
const ITAD_EPIC_SHOP_ID = 16;
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

async function fetchJsonWithHeaders(url, headers) {
  const response = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'discord-free-games-bot/1.0',
      ...headers
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

function normalizeDealName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function getDealDedupeKey(deal) {
  return `${deal.platform.toLowerCase()}:${normalizeDealName(deal.name)}`;
}

function withDedupeKey(deal) {
  return {
    ...deal,
    dedupeKey: getDealDedupeKey(deal)
  };
}

function isDirectStoreUrl(url) {
  return /store\.steampowered\.com|store\.epicgames\.com/i.test(url);
}

function mergeDeals(deals) {
  const merged = new Map();

  for (const deal of deals.map(withDedupeKey)) {
    const existing = merged.get(deal.dedupeKey);

    if (!existing || (!isDirectStoreUrl(existing.url) && isDirectStoreUrl(deal.url))) {
      merged.set(deal.dedupeKey, deal);
    }
  }

  return [...merged.values()];
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

  return mergeDeals([...deals.values()]);
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

function getEpicSlugFromUrl(url) {
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    const productIndex = parts.indexOf('p');

    if (!parsed.hostname.endsWith('epicgames.com') || productIndex === -1 || !parts[productIndex + 1]) {
      return null;
    }

    return parts[productIndex + 1];
  } catch {
    return null;
  }
}

function nameFromEpicSlug(slug) {
  return slug
    .replace(/-[a-f0-9]{6,}$/i, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function parseExtraEpicFreeGames(rawValue = '') {
  return rawValue
    .split(/\r?\n|;/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [maybeName, maybeUrl] = entry.includes('|')
        ? entry.split('|').map((part) => part.trim())
        : ['', entry];
      const url = maybeUrl || maybeName;
      const slug = getEpicSlugFromUrl(url);

      if (!slug) {
        return null;
      }

      return {
        id: `epic-extra:${slug}`,
        platform: 'Epic Games',
        name: maybeUrl ? maybeName : nameFromEpicSlug(slug),
        url,
        originalPrice: null,
        finalPrice: 0
      };
    })
    .filter(Boolean);
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

export function getExtraEpicFreeDeals({ extraEpicFreeGames = process.env.EPIC_EXTRA_FREE_GAMES } = {}) {
  return parseExtraEpicFreeGames(extraEpicFreeGames);
}

export async function getItadEpicFreeDeals({
  country = 'SK',
  itadApiKey = process.env.ITAD_API_KEY
} = {}) {
  if (!itadApiKey) {
    return [];
  }

  const url = buildUrl(ITAD_DEALS_URL, {
    country,
    limit: 100,
    sort: '-cut',
    shops: ITAD_EPIC_SHOP_ID,
    mature: true,
    filter: JSON.stringify({
      cut: {
        min: 100,
        max: 100
      }
    })
  });

  const data = await fetchJsonWithHeaders(url, {
    'ITAD-API-Key': itadApiKey
  });

  return (data?.list ?? [])
    .filter((item) => {
      const deal = item?.deal;
      return item?.id
        && item?.title
        && deal?.shop?.id === ITAD_EPIC_SHOP_ID
        && deal?.cut === 100
        && deal?.price?.amountInt === 0;
    })
    .map((item) => ({
      id: `itad-epic:${item.id}`,
      platform: 'Epic Games',
      name: item.title,
      url: item.deal.url,
      originalPrice: item.deal.regular?.amountInt ?? null,
      finalPrice: item.deal.price?.amountInt ?? 0
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
    getEpicFreeDeals({ country: epicCountry, locale }),
    getItadEpicFreeDeals({ country: epicCountry, itadApiKey: options.itadApiKey }),
    Promise.resolve(getExtraEpicFreeDeals(options))
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

  return { deals: mergeDeals(deals), errors };
}
