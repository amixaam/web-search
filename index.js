#!/usr/bin/env bun
/**
 * Runtime: Bun
 * Categories: "general", "images", "news"
 * Fetch mode: extract full text content from a single URL
 *   - Checks /llms.txt and Accept: text/markdown before falling back to DOM extraction
 *   - Uses Mozilla Readability for clean content extraction
 *   - Truncates output to protect LLM context window
 */

import { htmlToMarkdown } from "./extract.js";

const SEARXNG_URL = "https://search.amixam.net";
const MAX_QUANTITY = 20;
const MAX_PAGES = 3;
const DEFAULT_MAX_LENGTH = 15_000;

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
};

// ── SearXNG search ─────────────────────────────────────────────────────────────

async function fetchPage(query, category, page = 1, timeRange) {
  const url = new URL(`${SEARXNG_URL}/search`);
  url.searchParams.append("q", query);
  url.searchParams.append("categories", category);
  url.searchParams.append("format", "json");
  url.searchParams.append("pageno", String(page));
  url.searchParams.append("language", "all");
  if (timeRange) url.searchParams.append("time_range", timeRange);

  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return data.results || [];
  } catch (err) {
    console.error(`[Error] Failed to fetch page ${page}:`, err.message);
    return [];
  }
}

// ── Deep dive ──────────────────────────────────────────────────────────────────

async function tryLlmsTxt(baseUrl) {
  for (const path of ["/llms.txt", "/llms-full.txt"]) {
    try {
      const url = new URL(path, baseUrl).href;
      const res = await fetch(url, { headers: BROWSER_HEADERS });
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
  return null;
}

async function tryMarkdownAccept(url) {
  try {
    const res = await fetch(url, {
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
  const res = await fetch(url, { headers: BROWSER_HEADERS });
  if (!res.ok) return { error: `HTTP ${res.status}: ${res.statusText}` };
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("text/html")) return { error: `Unsupported content type: ${ct}` };
  const html = await res.text();
  const result = htmlToMarkdown(html, { useReadability: true, maxLength });
  return result;
}

async function deepFetch(targetUrl, maxLength = DEFAULT_MAX_LENGTH) {
  let parsed;
  try { parsed = new URL(targetUrl); }
  catch { return { url: targetUrl, error: "Invalid URL" }; }

  const llmsTxt = await tryLlmsTxt(parsed.origin);
  if (llmsTxt) return { url: targetUrl, ...llmsTxt };

  const markdown = await tryMarkdownAccept(targetUrl);
  if (markdown) return { url: targetUrl, ...markdown };

  try {
    const result = await scrapeHtml(targetUrl, maxLength);
    if (result.error) return { url: targetUrl, ...result };
    return {
      url: targetUrl,
      source: result.extractionMethod,
      content: result.content,
      truncated: result.truncated,
      charCount: result.charCount,
    };
  } catch (err) {
    return { url: targetUrl, error: err.message };
  }
}

// ── Search helper ─────────────────────────────────────────────────────────────

async function searchQuery(query, quantity, category, timeRange) {
  const clampedQuantity = Math.min(Math.max(1, quantity), MAX_QUANTITY);
  let allResults = [];
  let page = 1;

  while (allResults.length < clampedQuantity && page <= MAX_PAGES) {
    const results = await fetchPage(query, category, page, timeRange);
    if (results.length === 0) break;
    allResults.push(...results);
    page++;
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
    const maxLen = params.max_length ?? DEFAULT_MAX_LENGTH;
    const result = await deepFetch(fetchUrl, maxLen);
    if (result.error) {
      process.stderr.write(`[Error] ${result.url}: ${result.error}\n`);
      process.exit(1);
    }
    const truncatedNote = result.truncated ? `\n\n[Output truncated to ~${maxLen} chars from ${result.charCount}]` : "";
    process.stdout.write(`[source: ${result.source}]\n[url: ${result.url}]${truncatedNote}\n\n${result.content}\n`);
    return;
  }

  // ── SEARCH MODE ────────────────────────────────────────────────────────────
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

  const output = {
    queries: searchQueries,
    results,
  };

  console.log(JSON.stringify(output, null, 2));
}

main();