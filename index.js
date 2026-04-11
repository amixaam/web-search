/**
 * Environment: Ubuntu 24.04 (Nucbox G3) | Runtime: Bun
 * Categories: "general", "images", "news"
 * Deep mode: fetch and extract full text content from a single URL
 *   - Checks /llms.txt and Accept: text/markdown before falling back to HTML scraping
 */

const SEARXNG_URL = "http://localhost:8181";
const MAX_QUANTITY = 20;
const MAX_PAGES = 3;

// --- Entity decoding ---

function decodeHTMLEntities(str) {
  return str
    // Hex numeric entities: &#x27; &#x3C; &#x26; etc.
    .replace(/&#x([0-9a-fA-F]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16))
    )
    // Decimal numeric entities: &#39; &#60; etc.
    .replace(/&#(\d+);/g, (_, dec) =>
      String.fromCodePoint(parseInt(dec, 10))
    )
    // Named entities (common set)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&laquo;/g, "«")
    .replace(/&raquo;/g, "»");
}

// --- Shared fetch headers ---

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
};

// --- SearXNG search ---

async function fetchPage(query, category, page = 1) {
  const url = new URL(`${SEARXNG_URL}/search`);
  url.searchParams.append("q", query);
  url.searchParams.append("categories", category);
  url.searchParams.append("format", "json");
  url.searchParams.append("pageno", String(page));
  url.searchParams.append("language", "all");

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

/**
 * Strategy 1: check if the site has /llms.txt or /llms-full.txt.
 * Returns content string or null.
 */
async function tryLlmsTxt(baseUrl) {
  for (const path of ["/llms.txt", "/llms-full.txt"]) {
    try {
      const url = new URL(path, baseUrl).href;
      const res = await fetch(url, { headers: BROWSER_HEADERS });
      if (res.ok) {
        const ct = res.headers.get("content-type") || "";
        const isHtml = ct.includes("text/html");
        const isText = ct.includes("text/plain") || ct.includes("text/markdown") || ct.includes("markdown");
        if (!isHtml && isText) {
          const text = await res.text();
          if (text.trim().length > 100) {
            return { source: "llms.txt", url, content: text.trim() };
          }
        }
      }
    } catch {
      // not available, try next
    }
  }
  return null;
}

/**
 * Strategy 2: request Markdown via Accept header (Fern, Mintlify, etc.)
 * Returns content string or null.
 */
async function tryMarkdownAccept(url) {
  try {
    const res = await fetch(url, {
      headers: {
        ...BROWSER_HEADERS,
        Accept: "text/markdown, text/plain;q=0.9, text/html;q=0.5",
      },
    });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("markdown") || ct.includes("text/plain")) {
      const text = await res.text();
      if (text.trim().length > 100) {
        return { source: "markdown", content: text.trim() };
      }
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Strategy 3: full HTML scrape + entity decode.
 */
async function scrapeHtml(url) {
  const res = await fetch(url, { headers: BROWSER_HEADERS });
  if (!res.ok) {
    return { url, error: `HTTP ${res.status}: ${res.statusText}` };
  }
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("text/html")) {
    return { url, error: `Unsupported content type: ${ct}` };
  }

  const html = await res.text();

  const text = decodeHTMLEntities(
    html
      // Strip noisy blocks entirely
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<nav[\s\S]*?<\/nav>/gi, "")
      .replace(/<footer[\s\S]*?<\/footer>/gi, "")
      .replace(/<header[\s\S]*?<\/header>/gi, "")
      .replace(/<aside[\s\S]*?<\/aside>/gi, "")
      // Block-level spacing before stripping tags
      .replace(/<\/(p|div|li|h[1-6]|blockquote|tr|section|article)>/gi, "\n")
      .replace(/<br\s*\/?>/gi, "\n")
      // Strip all remaining tags
      .replace(/<[^>]+>/g, "")
      // Collapse blank lines
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );

  return { source: "html", content: text };
}

async function deepFetch(targetUrl) {
  // Validate URL
  let parsed;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return { url: targetUrl, error: "Invalid URL" };
  }

  // Try strategies in order, most LLM-friendly first
  const llmsTxt = await tryLlmsTxt(parsed.origin);
  if (llmsTxt) {
    return { url: targetUrl, ...llmsTxt };
  }

  const markdown = await tryMarkdownAccept(targetUrl);
  if (markdown) {
    return { url: targetUrl, ...markdown };
  }

  try {
    const html = await scrapeHtml(targetUrl);
    return { url: targetUrl, ...html };
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
  try {
    params = JSON.parse(arg);
  } catch {
    console.error(JSON.stringify({ error: "Invalid JSON input" }));
    process.exit(1);
  }

  // Deep dive mode — print as plain text, not JSON
  if (params.deep) {
    const result = await deepFetch(params.deep);
    if (result.error) {
      process.stderr.write(`[Error] ${result.url}: ${result.error}\n`);
      process.exit(1);
    }
    process.stdout.write(`[source: ${result.source}]\n[url: ${result.url}]\n\n${result.content}\n`);
    return;
  }

  // Search mode
  const { query, quantity = 3, category = "general" } = params;

  const validCategories = ["general", "images", "news"];
  if (!validCategories.includes(category)) {
    console.error(
      JSON.stringify({
        error: `Invalid category "${category}". Must be one of: ${validCategories.join(", ")}`,
      })
    );
    process.exit(1);
  }

  const clampedQuantity = Math.min(Math.max(1, quantity), MAX_QUANTITY);

  let allResults = [];
  let pageToFetch = 1;

  while (allResults.length < clampedQuantity && pageToFetch <= MAX_PAGES) {
    const results = await fetchPage(query, category, pageToFetch);
    if (results.length === 0) break;
    allResults = [...allResults, ...results];
    pageToFetch++;
  }

  const finalResults = allResults.slice(0, clampedQuantity).map((r) => {
    const isImage = category === "images" || !!r.img_src;
    const displayUrl = isImage
      ? r.img_src || r.thumbnail_src || r.url
      : r.url;

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
