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
 *
 * For pi integration, see src/extension/index.ts (registers web_search + web_fetch tools).
 */

import { searchQuery, deepFetch, DEFAULT_MAX_LENGTH } from "./lib/search.js";

// ── Main ──────────────────────────────────────────────────────────────────────

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

  // ── FETCH MODE ─────────────────────────────────────────────────────────────
  const fetchUrl = params.fetch || params.deep;
  if (fetchUrl) {
    const maxLen =
      Number.isFinite(params.max_length) && params.max_length > 0
        ? params.max_length
        : DEFAULT_MAX_LENGTH;
    const result = await deepFetch(fetchUrl, maxLen);
    if (result.error) {
      console.error(
        JSON.stringify({ error: `${result.url}: ${result.error}` }),
      );
      process.exit(1);
    }
    const truncatedNote = result.truncated
      ? `\n\n[Output truncated to ~${maxLen} chars from ${result.charCount} — re-fetch with higher max_length for full content]`
      : "";
    process.stdout.write(
      `[source: ${result.source}]\n[url: ${result.url}]${truncatedNote}\n\n${result.content}\n`,
    );
    process.exit(0);
  }

  // ── SEARCH MODE ────────────────────────────────────────────────────────────
  if (!process.env.SEARXNG_URL) {
    console.error(
      JSON.stringify({
        error: "SEARXNG_URL environment variable is not set",
      }),
    );
    process.exit(1);
  }

  const {
    query,
    queries,
    quantity = 4,
    category = "general",
    time_range,
  } = params;
  const validCategories = ["general", "images", "news"];
  if (!validCategories.includes(category)) {
    console.error(
      JSON.stringify({
        error: `Invalid category "${category}". Must be one of: ${validCategories.join(", ")}`,
      }),
    );
    process.exit(1);
  }

  const rawQueries = queries ?? query;
  const searchQueries = Array.isArray(rawQueries)
    ? rawQueries
    : rawQueries
      ? [rawQueries]
      : [];
  if (searchQueries.length === 0) {
    console.error(JSON.stringify({ error: "No query or queries provided" }));
    process.exit(1);
  }

  const results = await Promise.all(
    searchQueries.map((q) =>
      searchQuery(q, quantity, category, time_range),
    ),
  );

  const warnings = [];
  const labeledResults = searchQueries.map((q, i) => {
    if (results[i].length === 0) {
      warnings.push(
        `No results for "${q}" — SearXNG may be unreachable or query too narrow`,
      );
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
