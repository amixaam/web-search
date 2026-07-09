import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { searchQuery } from '../../lib/search.js';

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: 'web_search',
    label: 'Web Search',
    description:
      'Search the web through SearXNG and return normalized, deduplicated result URLs. Use Obscura to read a selected URL.',
    promptSnippet: 'Search the web and return ranked result URLs',
    promptGuidelines: [
      'Use web_search to find current information, documentation, or recent events.',
      'Use Obscura to render and read a promising result URL; this extension only discovers sources.',
    ],
    parameters: Type.Object({
      queries: Type.Union([Type.String(), Type.Array(Type.String())], {
        description:
          'Search query string or array of query strings for parallel multi-perspective search',
      }),
      quantity: Type.Optional(Type.Number({ minimum: 1, maximum: 20, default: 3 })),
      page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
      category: Type.Optional(Type.String({ default: 'general' })),
      time_range: Type.Optional(Type.String()),
      language: Type.Optional(Type.String({ default: 'all' })),
      domains: Type.Optional(
        Type.Array(Type.String(), {
          description: 'Only include these domains; subdomains match too',
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const queries = Array.isArray(params.queries) ? params.queries : [params.queries];
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

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              { results: queries.map((query, index) => ({ query, results: results[index] })) },
              null,
              2,
            ),
          },
        ],
        details: {},
      };
    },
  });
}
