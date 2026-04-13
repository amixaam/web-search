#!/usr/bin/env bun
/**
 * Runtime: Bun
 * Categories: "general", "images", "news"
 * Fetch mode: extract full text content from a single URL
 *   - Checks /llms.txt and Accept: text/markdown before falling back to DOM extraction
 */

import { htmlToMarkdown } from "./extract.js";

const SEARXNG_URL = "https://search.amixam.net";
const MAX_QUANTITY = 20;
const MAX_PAGES = 3;

const BROWSER_HEADERS = {
  "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
};

// --- SearXNG search ---

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

// --- Deep dive ---

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

async function scrapeHtml(url) {
  const res = await fetch(url, { headers: BROWSER_HEADERS });
  if (!res.ok) return { error: `HTTP ${res.status}: ${res.statusText}` };
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("text/html")) return { error: `Unsupported content type: ${ct}` };
  const html = await res.text();
  const content = htmlToMarkdown(html);
  return content ? { source: "html", content } : { error: "No extractable content found" };
}

async function deepFetch(targetUrl) {
  let parsed;
  try { parsed = new URL(targetUrl); }
  catch { return { url: targetUrl, error: "Invalid URL" }; }

  // Try strategies in order, most LLM-friendly first
  const llmsTxt = await tryLlmsTxt(parsed.origin);
  if (llmsTxt) return { url: targetUrl, ...llmsTxt };

  const markdown = await tryMarkdownAccept(targetUrl);
  if (markdown) return { url: targetUrl, ...markdown };

  // Fallback: DOM-based extraction
  try {
    const result = await scrapeHtml(targetUrl);
    return { url: targetUrl, ...result };
  } catch (err) {
    return { url: targetUrl, error: err.message };
  }
}

// --- Main ---

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

  // Fetch mode — full content from a single URL
  const fetchUrl = params.fetch || params.deep; // "deep" kept for backward compat
  if (fetchUrl) {
    const result = await deepFetch(fetchUrl);
    if (result.error) {
      process.stderr.write(`[Error] ${result.url}: ${result.error}\n`);
      process.exit(1);
    }
    process.stdout.write(`[source: ${result.source}]\n[url: ${result.url}]\n\n${result.content}\n`);
    return;
  }

  // Search mode
  const { query, quantity = 4, category = "general", time_range } = params;
  const validCategories = ["general", "images", "news"];
  if (!validCategories.includes(category)) {
    console.error(JSON.stringify({
      error: `Invalid category "${category}". Must be one of: ${validCategories.join(", ")}`,
    }));
    process.exit(1);
  }

  const clampedQuantity = Math.min(Math.max(1, quantity), MAX_QUANTITY);
  let allResults = [];
  let page = 1;

  while (allResults.length < clampedQuantity && page <= MAX_PAGES) {
    const results = await fetchPage(query, category, page, time_range);
    if (results.length === 0) break;
    allResults.push(...results);
    page++;
  }

  const finalResults = allResults.slice(0, clampedQuantity).map((r) => {
    const isImage = category === "images" || !!r.img_src;
    const displayUrl = isImage ? (r.img_src || r.thumbnail_src || r.url) : r.url;
    return {
      title: r.title,
      url: displayUrl,
      ...(isImage && r.url !== displayUrl ? { source_page: r.url } : {}),
      content: (r.content || r.snippet || "No description available").substring(0, 600),
    };
  });

  console.log(JSON.stringify(finalResults, null, 2));
}

main();
