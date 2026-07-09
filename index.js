#!/usr/bin/env node

import { searchQuery } from './lib/search.js';

function fail(message) {
  process.stderr.write(`${JSON.stringify({ error: message })}\n`);
  process.exit(1);
}

async function main() {
  const arg = process.argv[2];
  if (!arg) fail('No input JSON provided');
  let params;
  try {
    params = JSON.parse(arg);
  } catch {
    fail('Invalid JSON input');
  }
  if (params.fetch || params.deep)
    fail('Fetching was removed; this tool only searches for sources.');

  const rawQueries = params.queries ?? params.query;
  const queries = Array.isArray(rawQueries) ? rawQueries : [rawQueries];
  if (!queries.length || queries.some((query) => typeof query !== 'string' || !query.trim())) {
    fail('query or queries must contain non-empty strings');
  }

  const results = await Promise.all(
    queries.map((query) =>
      searchQuery({
        query,
        quantity: params.quantity ?? 3,
        page: params.page ?? 1,
        category: params.category ?? 'general',
        timeRange: params.time_range,
        language: params.language ?? 'all',
        domains: params.domains,
      }),
    ),
  );
  console.log(
    JSON.stringify(
      { results: queries.map((query, index) => ({ query, results: results[index] })) },
      null,
      2,
    ),
  );
}

main().catch((error) => fail(error.message));
