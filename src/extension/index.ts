import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { searchQuery, deepFetch, DEFAULT_MAX_LENGTH } from "../../lib/search.js";

export default function (pi: ExtensionAPI) {
  // ── web_search ────────────────────────────────────────────────────────────

  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description:
      "Search the web via SearXNG and return ranked results. Use to find current information, docs, news, or any topic.",
    promptSnippet: "Search the web and return ranked results",
    promptGuidelines: [
      "Use web_search to find current information, documentation, or answer questions about recent events.",
      "After getting search results, use web_fetch on promising URLs to read full page content.",
    ],
    parameters: Type.Object({
      queries: Type.Union([Type.String(), Type.Array(Type.String())], {
        description:
          "Search query string or array of query strings for parallel multi-perspective search",
      }),
      quantity: Type.Optional(
        Type.Number({ minimum: 1, maximum: 20, default: 4 }),
      ),
      category: Type.Optional(
        Type.String({ default: "general" }),
      ),
      time_range: Type.Optional(Type.String()),
    }),
    async execute(toolCallId, params, _signal, _onUpdate, _ctx) {
      const queries = Array.isArray(params.queries)
        ? params.queries
        : [params.queries];
      const quantity = params.quantity ?? 4;
      const category = params.category ?? "general";
      const timeRange = params.time_range || undefined;

      const results = await Promise.all(
        queries.map((q) => searchQuery(q, quantity, category, timeRange)),
      );

      const warnings: string[] = [];
      const labeled = queries.map((q, i) => {
        if (results[i].length === 0) {
          warnings.push(
            `No results for "${q}" — SearXNG may be unreachable or query too narrow`,
          );
        }
        return { query: q, results: results[i] };
      });

      const output = JSON.stringify(
        warnings.length
          ? { results: labeled, warnings }
          : { results: labeled },
        null,
        2,
      );

      return {
        content: [{ type: "text", text: output }],
        details: {},
      };
    },
  });

  // ── web_fetch ─────────────────────────────────────────────────────────────

  pi.registerTool({
    name: "web_fetch",
    label: "Web Fetch",
    description:
      "Fetch and extract full content from a URL as clean markdown. Prefers llms.txt, then text/markdown, then HTML extraction.",
    promptSnippet: "Fetch and extract full page content from a URL",
    promptGuidelines: [
      "Use web_fetch after web_search to read full content from promising search result URLs.",
      "web_fetch tries llms.txt first, then markdown content negotiation, then falls back to HTML extraction.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "Full URL to fetch content from" }),
      max_length: Type.Optional(
        Type.Number({ default: DEFAULT_MAX_LENGTH }),
      ),
    }),
    async execute(toolCallId, params, _signal, _onUpdate, _ctx) {
      const maxLength = params.max_length ?? DEFAULT_MAX_LENGTH;
      const result = await deepFetch(params.url, maxLength);

      if (result.error) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: `${result.url}: ${result.error}`,
              }),
            },
          ],
          details: {},
        };
      }

      const truncatedNote = result.truncated
        ? `\n\n[Output truncated to ~${maxLength} chars from ${result.charCount} — re-fetch with higher max_length for full content]`
        : "";

      const text = `[source: ${result.source}]\n[url: ${result.url}]${truncatedNote}\n\n${result.content}`;

      return {
        content: [{ type: "text", text }],
        details: {
          source: result.source,
          url: result.url,
          charCount: result.charCount,
          truncated: result.truncated,
        },
      };
    },
  });
}
