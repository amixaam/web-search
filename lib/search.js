import { htmlToMarkdown } from "../extract.js";

const SEARXNG_URL = process.env.SEARXNG_URL;
const MAX_QUANTITY = 20;
const MAX_PAGES = 3;
export const DEFAULT_MAX_LENGTH = 15_000;

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Encoding": "gzip, deflate",
};

const FETCH_TIMEOUT_MS = 15_000;

/** Fetch with a timeout. Aborts and throws after timeoutMs. */
async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ── SearXNG search ─────────────────────────────────────────────────────────────

async function fetchPage(query, category, page = 1, timeRange) {
  if (!SEARXNG_URL) return [];
  const url = new URL(`${SEARXNG_URL}/search`);
  url.searchParams.append("q", query);
  url.searchParams.append("categories", category);
  url.searchParams.append("format", "json");
  url.searchParams.append("pageno", String(page));
  url.searchParams.append("language", "all");
  if (timeRange) url.searchParams.append("time_range", timeRange);

  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) return [];
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("application/json")) return [];
    const data = await res.json();
    return data.results || [];
  } catch {
    return [];
  }
}

// ── Deep fetch ─────────────────────────────────────────────────────────────────

async function tryLlmsTxt(baseUrl) {
  const baseWithSlash = baseUrl.replace(/\/?$/, "/");
  const seen = new Set();

  const pathDepth = new URL(baseUrl)
    .pathname.replace(/\/$/, "")
    .split("/")
    .filter(Boolean).length;
  const tryDomainRoot = pathDepth <= 1;

  for (const suffix of ["llms.txt", "llms-full.txt"]) {
    const urls = [new URL(suffix, baseWithSlash).href];
    if (tryDomainRoot) {
      urls.push(new URL("/" + suffix, baseUrl).href);
    }
    for (const url of urls) {
      if (seen.has(url)) continue;
      seen.add(url);
      try {
        const res = await fetchWithTimeout(url, { headers: BROWSER_HEADERS });
        if (res.ok) {
          const ct = res.headers.get("content-type") || "";
          if (
            (ct.includes("text/plain") || ct.includes("text/markdown") || ct.includes("markdown")) &&
            !ct.includes("text/html")
          ) {
            const text = await res.text();
            if (text.trim().length > 100) {
              return { source: "llms.txt", url, content: text.trim() };
            }
          }
        }
      } catch {
        // try next
      }
    }
  }
  return null;
}

async function tryMarkdownAccept(url) {
  try {
    const res = await fetchWithTimeout(url, {
      headers: {
        ...BROWSER_HEADERS,
        Accept: "text/markdown, text/plain;q=0.9, text/html;q=0.5",
      },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("markdown") || ct.includes("text/plain")) {
      const text = await res.text();
      if (text.trim().length > 100) return { source: "markdown", content: text.trim() };
    }
  } catch {
    // fall through
  }
  return null;
}

async function scrapeHtml(url, maxLength = DEFAULT_MAX_LENGTH) {
  const res = await fetchWithTimeout(url, { headers: BROWSER_HEADERS });
  if (!res.ok) return { error: `HTTP ${res.status}: ${res.statusText}` };
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("text/html")) return { error: `Unsupported content type: ${ct}` };
  const html = await res.text();
  return htmlToMarkdown(html, { useReadability: true, maxLength, baseUrl: url });
}

/**
 * Fetch full content from a single URL.
 * Tries: llms.txt → Accept: text/markdown → HTML extraction.
 */
export async function deepFetch(targetUrl, maxLength = DEFAULT_MAX_LENGTH) {
  try {
    new URL(targetUrl);
  } catch {
    return { url: targetUrl, error: "Invalid URL" };
  }

  // 1. Try llms.txt first (lightest)
  const llmsTxt = await tryLlmsTxt(targetUrl);
  if (llmsTxt) {
    const lines = llmsTxt.content.split("\n");
    const linkLines = lines.filter(
      (l) =>
        /^\s*[-*+]?\s*\[.+?\]\(.+?\)/.test(l) ||
        /^\s*[-*+]?\s*https?:\/\//.test(l),
    );
    const isSitemap =
      lines.length > 5 && linkLines.length / lines.length > 0.6;
    const note = isSitemap
      ? "\n\n[Note: this is a navigation index (llms.txt sitemap), not article content. Use fetch on specific doc pages for full text.]"
      : "";
    return {
      url: targetUrl,
      ...llmsTxt,
      content: llmsTxt.content + note,
    };
  }

  // 2. Try Accept: text/markdown
  const markdown = await tryMarkdownAccept(targetUrl);
  if (markdown) return { url: targetUrl, ...markdown };

  // 3. HTML extraction
  try {
    const result = await scrapeHtml(targetUrl, maxLength);
    if (result.error) return { url: targetUrl, ...result };
    return {
      url: targetUrl,
      source: result.source,
      content: result.content,
      truncated: result.truncated,
      charCount: result.charCount,
    };
  } catch (err) {
    return { url: targetUrl, error: err.message };
  }
}

// ── Search ─────────────────────────────────────────────────────────────────────

/**
 * Execute a search query, fetching up to MAX_PAGES sequentially.
 */
export async function searchQuery(query, quantity, category, timeRange) {
  if (!SEARXNG_URL) {
    throw new Error("SEARXNG_URL environment variable is not set");
  }
  const clampedQuantity = Math.min(Math.max(1, quantity), MAX_QUANTITY);

  const allResults = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const results = await fetchPage(query, category, page, timeRange);
    allResults.push(...results);
    if (results.length < 8) break;
  }

  return allResults.slice(0, clampedQuantity).map((r) => {
    const isImage = category === "images" || !!r.img_src;
    const displayUrl = isImage
      ? r.img_src || r.thumbnail_src || r.url
      : r.url;
    return {
      title: r.title,
      url: displayUrl,
      ...(isImage && r.url !== displayUrl ? { source_page: r.url } : {}),
      content: (r.content || r.snippet || "No description available").substring(
        0,
        600,
      ),
    };
  });
}
