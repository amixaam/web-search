#!/usr/bin/env node
/**
 * Web search via SearXNG and full-page markdown extraction.
 *
 * Modes:
 *   search  — query SearXNG, return ranked results as JSON
 *   fetch   — extract full content from a single URL (llms.txt → markdown accept → HTML scrape)
 *
 * Categories: "general", "images", "news"
 * Runtime: Node.js
 */

import { htmlToMarkdown } from "./extract.js";

const SEARXNG_URL = process.env.SEARXNG_URL;
const MAX_QUANTITY = 20;
const MAX_PAGES = 3;
const DEFAULT_MAX_LENGTH = 15_000;

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
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

/**
 * Fetch a single page of search results from SearXNG.
 * @param {string} query
 * @param {string} category - "general" | "images" | "news"
 * @param {number} [page=1]
 * @param {string} [timeRange] - "day" | "week" | "month" | "year"
 * @returns {Promise<Array>}
 */
async function fetchPage(query, category, page = 1, timeRange) {
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
    if (!ct.includes("application/json")) {
      // SearXNG returned non-JSON (HTML error page, redirect, etc.)
      return [];
    }
    const data = await res.json();
    return data.results || [];
  } catch (err) {
    return [];
  }
}

// ── Deep dive ──────────────────────────────────────────────────────────────────

async function tryLlmsTxt(baseUrl) {
  // Try path-relative first (e.g. github.com/oven-sh/bun/llms.txt),
  // then domain-root (e.g. bun.sh/llms.txt) — but ONLY for shallow URLs.
  // For deep pages like bun.sh/docs/runtime/shell, the domain-root
  // llms.txt is a global sitemap, unrelated to the requested content.
  const baseWithSlash = baseUrl.replace(/\/?$/, '/');
  const seen = new Set();

  // Only try domain-root for URLs with ≤1 path segment (domain root or /foo)
  const pathDepth = new URL(baseUrl).pathname.replace(/\/$/, '').split('/').filter(Boolean).length;
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
        // site doesn't have it, try next
      }
    }
  }
  return null;
}

async function tryMarkdownAccept(url) {
  try {
    const res = await fetchWithTimeout(url, {
      headers: { ...BROWSER_HEADERS, Accept: "text/markdown, text/plain;q=0.9, text/html;q=0.5" },
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
  const result = htmlToMarkdown(html, { useReadability: true, maxLength, baseUrl: url });
  return result;
}

async function deepFetch(targetUrl, maxLength = DEFAULT_MAX_LENGTH) {
  try { new URL(targetUrl); }
  catch { return { url: targetUrl, error: "Invalid URL" }; }

  // 1. Try llms.txt first (lightest)
  const llmsTxt = await tryLlmsTxt(targetUrl);
  if (llmsTxt) {
    // Detect if response is a sitemap (mostly links, not article content)
    const lines = llmsTxt.content.split('\n');
    const linkLines = lines.filter(l => /^\s*[-*+]?\s*\[.+?\]\(.+?\)/.test(l) || /^\s*[-*+]?\s*https?:\/\//.test(l));
    const isSitemap = lines.length > 5 && linkLines.length / lines.length > 0.6;
    const note = isSitemap
      ? '\n\n[Note: this is a navigation index (llms.txt sitemap), not article content. Use fetch on specific doc pages for full text.]'
      : '';
    return { url: targetUrl, ...llmsTxt, content: llmsTxt.content + note };
  }

  // 2. Try Accept: text/markdown
  const markdown = await tryMarkdownAccept(targetUrl);
  if (markdown) return { url: targetUrl, ...markdown };

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

// ── Search helper ─────────────────────────────────────────────────────────────

/**
 * Execute a search query, fetching up to MAX_PAGES sequentially.
 * @param {string} query
 * @param {number} quantity
 * @param {string} category
 * @param {string} [timeRange]
 * @returns {Promise<Array>}
 */
async function searchQuery(query, quantity, category, timeRange) {
  const clampedQuantity = Math.min(Math.max(1, quantity), MAX_QUANTITY);

  // Fetch pages sequentially with early exit: if a page returns < expected,
  // stop fetching further pages (no more results available)
  const allResults = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const results = await fetchPage(query, category, page, timeRange);
    allResults.push(...results);
    // SearXNG typically returns ~10-15 results per page.
    // If we got fewer than 8, there are likely no more results.
    if (results.length < 8) break;
  }

  return allResults.slice(0, clampedQuantity).map((r) => {
    const isImage = category === "images" || !!r.img_src;
    const displayUrl = isImage ? (r.img_src || r.thumbnail_src || r.url) : r.url;
    return {
      title: r.title,
      url: displayUrl,
      ...(isImage && r.url !== displayUrl ? { source_page: r.url } : {}),
      content: (r.content || r.snippet || "No description available").substring(0, 600),
    };
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error(JSON.stringify({ error: "No input JSON provided" }));
    process.exit(1);
  }

  let params;
  try { params = JSON.parse(arg); }
  catch {
    console.error(JSON.stringify({ error: "Invalid JSON input" }));
    process.exit(1);
  }

  // ── FETCH MODE ─────────────────────────────────────────────────────────────
  const fetchUrl = params.fetch || params.deep;
  if (fetchUrl) {
    const maxLen = Number.isFinite(params.max_length) && params.max_length > 0
      ? params.max_length
      : DEFAULT_MAX_LENGTH;
    const result = await deepFetch(fetchUrl, maxLen);
    if (result.error) {
      console.error(JSON.stringify({ error: `${result.url}: ${result.error}` }));
      process.exit(1);
    }
    const truncatedNote = result.truncated ? `\n\n[Output truncated to ~${maxLen} chars from ${result.charCount} — re-fetch with higher max_length for full content]` : "";
    process.stdout.write(`[source: ${result.source}]\n[url: ${result.url}]${truncatedNote}\n\n${result.content}\n`);
    process.exit(0);
  }

  // ── SEARCH MODE ────────────────────────────────────────────────────────────
  if (!SEARXNG_URL) {
    console.error(JSON.stringify({ error: "SEARXNG_URL environment variable is not set" }));
    process.exit(1);
  }

  const { query, queries, quantity = 4, category = "general", time_range } = params;
  const validCategories = ["general", "images", "news"];
  if (!validCategories.includes(category)) {
    console.error(JSON.stringify({
      error: `Invalid category "${category}". Must be one of: ${validCategories.join(", ")}`,
    }));
    process.exit(1);
  }

  // Normalize to array (support both single string and array of strings)
  const rawQueries = queries ?? query;
  const searchQueries = Array.isArray(rawQueries) ? rawQueries : (rawQueries ? [rawQueries] : []);
  if (searchQueries.length === 0) {
    console.error(JSON.stringify({ error: "No query or queries provided" }));
    process.exit(1);
  }

  // Parallel execution
  const results = await Promise.all(
    searchQueries.map((q) => searchQuery(q, quantity, category, time_range))
  );

  // Build results with inline query labels for LLM readability
  const warnings = [];
  const labeledResults = searchQueries.map((q, i) => {
    if (results[i].length === 0) {
      warnings.push(`No results for "${q}" — SearXNG may be unreachable or query too narrow`);
    }
    return { query: q, results: results[i] };
  });

  const output = { results: labeledResults };
  if (warnings.length) output.warnings = warnings;

  console.log(JSON.stringify(output, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error(JSON.stringify({ error: err.message }));
  process.exit(1);
});