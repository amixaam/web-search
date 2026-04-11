---
name: web-search
description: "Search the web using a local SearXNG instance for real-time information, images, and news. Supports both broad search and deep single-URL content extraction."
metadata: {"openclaw": {"emoji": "🔍", "requires": {"bins": ["bun"]}, "always": true}}
user-invocable: true
---

# Web Search

Use this tool whenever you need current information — news, documentation, prices, recent events, or anything that changes over time or is unlikely to be in your training data.

The tool has two modes: **search** (broad, returns multiple results) and **deep** (focused, extracts full content from one URL).

## Modes

### Search mode

Returns a ranked list of results from SearXNG.

**Parameters:**

- `query` (required): The search terms or question.
- `quantity` (optional): Number of results to return, 1–20. Default: 3.
- `category` (optional): `"general"` | `"images"` | `"news"`. Default: `"general"`.

**Examples:**

```
web-search '{"query": "MacBook Air M3 benchmarks"}'
web-search '{"query": "latest React 19 release notes", "quantity": 5}'
web-search '{"query": "northern lights tonight", "category": "news"}'
web-search '{"query": "rust crab logo", "category": "images"}'
```

**Output** — a JSON array, one object per result:

```json
[
  {
    "title": "Page title",
    "url": "https://...",
    "content": "Short snippet (up to 600 chars)"
  }
]
```

For `images`, `url` is the direct image URL and `source_page` (when present) is the originating webpage.

---

### Deep mode

Fetches and extracts the full text content of a single URL. Use this to read documentation, articles, or any page in full after finding it via search.

The tool tries strategies in order, most LLM-friendly first:

1. `/llms.txt` or `/llms-full.txt` at the site root — clean, structured text
2. `Accept: text/markdown` header — Markdown if the server supports it
3. Full HTML scrape — strips scripts, nav, footer, and collapses whitespace

**Parameter:**

- `deep` (required): The full URL to fetch.

**Examples:**

```
web-search '{"deep": "https://tailwindcss.com/docs/dark-mode"}'
web-search '{"deep": "https://docs.ollama.com/"}'
```

**Output** — plain text prefixed with source metadata:

```
[source: llms.txt | markdown | html]
[url: https://...]

<full page content>
```

---

## When to use which mode

| Situation | Mode |
|---|---|
| You need to find relevant pages on a topic | `query` |
| You have a URL and need the full content | `deep` |
| You found a promising result and need more than the snippet | `deep` on that URL |
| You need recent news or images | `query` with `category` |

**Typical pattern — search then read:**

```
1. web-search '{"query": "Tailwind dark mode"}'
   → pick the best URL from results
2. web-search '{"deep": "https://tailwindcss.com/docs/dark-mode"}'
   → read the full documentation page
```

