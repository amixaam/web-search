const DEFAULT_SEARXNG_URL = 'https://search.amixam.net';
const MAX_QUANTITY = 20;
const MAX_PAGES = 3;
const FETCH_TIMEOUT_MS = 15_000;
const TRACKING_PARAMS = /^(utm_[^=]*|fbclid|gclid|dclid|msclkid|mc_[^=]*|ref_|ref)$/i;

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function getSearxngUrl() {
  const value = process.env.SEARXNG_URL || DEFAULT_SEARXNG_URL;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) throw new Error('unsupported protocol');
    return url.href.replace(/\/$/, '');
  } catch {
    throw new Error(`Invalid SEARXNG_URL: ${value}`);
  }
}

function canonicalUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch {
    return value;
  }
}

function normalizeDomains(domains) {
  if (domains === undefined) return [];
  if (
    !Array.isArray(domains) ||
    domains.some((domain) => typeof domain !== 'string' || !domain.trim())
  ) {
    throw new Error('domains must be an array of non-empty domain names');
  }
  return domains.map((domain) =>
    domain
      .trim()
      .toLowerCase()
      .replace(/^\*\./, '')
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, ''),
  );
}

function matchesDomains(value, domains) {
  if (domains.length === 0) return true;
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return domains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

async function fetchPage(baseUrl, options, page) {
  const url = new URL(`${baseUrl}/search`);
  url.searchParams.set('q', options.query);
  url.searchParams.set('categories', options.category);
  url.searchParams.set('format', 'json');
  url.searchParams.set('pageno', String(page));
  url.searchParams.set('language', options.language);
  if (options.timeRange) url.searchParams.set('time_range', options.timeRange);

  let response;
  try {
    response = await fetchWithTimeout(url, { headers: { Accept: 'application/json' } });
  } catch (error) {
    throw new Error(`Could not reach SearXNG: ${error.message}`);
  }
  if (!response.ok)
    throw new Error(`SearXNG returned HTTP ${response.status} ${response.statusText}`);
  try {
    const data = await response.json();
    return Array.isArray(data.results) ? data.results : [];
  } catch {
    throw new Error('SearXNG returned invalid JSON');
  }
}

function formatResult(result, category) {
  const isImage = category === 'images' || Boolean(result.img_src);
  const sourcePage = canonicalUrl(result.url || '');
  const url = isImage ? result.img_src || result.thumbnail_src || sourcePage : sourcePage;
  return {
    title: result.title || 'Untitled result',
    url,
    content: (result.content || result.snippet || 'No description available').slice(0, 600),
    ...(isImage && sourcePage && sourcePage !== url ? { source_page: sourcePage } : {}),
    ...(result.engines?.length ? { engines: result.engines } : {}),
    ...(result.publishedDate ? { published_date: result.publishedDate } : {}),
    ...(result.thumbnail_src || result.thumbnail
      ? { thumbnail: result.thumbnail_src || result.thumbnail }
      : {}),
  };
}

/** Search SearXNG and return normalized, deduplicated result records. */
export async function searchQuery({
  query,
  quantity = 3,
  category = 'general',
  timeRange,
  page = 1,
  language = 'all',
  domains,
}) {
  if (typeof query !== 'string' || !query.trim())
    throw new Error('query must be a non-empty string');
  if (!Number.isInteger(quantity) || quantity < 1)
    throw new Error('quantity must be a positive integer');
  if (!Number.isInteger(page) || page < 1) throw new Error('page must be a positive integer');
  if (typeof category !== 'string' || !category.trim())
    throw new Error('category must be a non-empty string');
  if (typeof language !== 'string' || !language.trim())
    throw new Error('language must be a non-empty string');
  if (timeRange !== undefined && !['day', 'week', 'month', 'year'].includes(timeRange)) {
    throw new Error('time_range must be day, week, month, or year');
  }

  const options = {
    query: query.trim(),
    category: category.trim(),
    language: language.trim(),
    timeRange,
  };
  const allowedDomains = normalizeDomains(domains);
  const results = [];
  const seen = new Set();
  const baseUrl = getSearxngUrl();

  for (
    let currentPage = page;
    currentPage < page + MAX_PAGES && results.length < Math.min(quantity, MAX_QUANTITY);
    currentPage++
  ) {
    const entries = await fetchPage(baseUrl, options, currentPage);
    if (entries.length === 0) break;
    for (const entry of entries) {
      const dedupeUrl = canonicalUrl(entry.url || entry.img_src || '');
      if (
        !dedupeUrl ||
        seen.has(dedupeUrl) ||
        !matchesDomains(entry.url || dedupeUrl, allowedDomains)
      )
        continue;
      seen.add(dedupeUrl);
      results.push(formatResult(entry, options.category));
      if (results.length === Math.min(quantity, MAX_QUANTITY)) break;
    }
  }

  return results;
}
