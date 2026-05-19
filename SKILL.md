---
name: web-search
description: "Web search via SearXNG and full-page markdown extraction. Registers web_search and web_fetch tools."
user-invocable: true
---

# Web Search & Fetch

Two tools are available once this skill is loaded:

- **`web_search`** — query SearXNG and return ranked results
- **`web_fetch`** — extract full content from a URL (llms.txt → markdown → HTML)

## web_search

| Parameter | Type | Default | Description |
|---|---|---|---|
| `queries` | string \| string[] | (required) | Search query or array for parallel multi-perspective search |
| `quantity` | number | 4 | Results per query (1–20) |
| `category` | string | `"general"` | `"general"`, `"news"`, or `"images"` |
| `time_range` | string | — | `"day"`, `"week"`, `"month"`, `"year"` |

## web_fetch

| Parameter | Type | Default | Description |
|---|---|---|---|
| `url` | string | (required) | Full URL to extract content from |
| `max_length` | number | 15000 | Character limit for returned content |

---

## Best Practices

### 1. Search-then-Read
Snippet text is often SEO garbage. Use `web_search` to find URLs, then `web_fetch` the best ones.

### 2. Parallel Queries
Run multiple variations at once for comprehensive coverage:
```
queries: ["RTX 5090 specs", "RTX 5090 release date", "RTX 5090 price comparison"]
```

### 3. Date & Context Injection
Always include the current date in queries. Use `time_range` only for breaking news.
- **Bad:** `queries: "iPhone 17 Pro price", time_range: "month"`
- **Good:** `queries: "iPhone 17 Pro retail price April 2026"`

### 4. Disambiguation by Exclusion
Use `-` to prune noise: `"Horizon game -Forbidden -Zero -Dawn"`

### 5. Target the Source of Truth
| Target | Strategy |
|---|---|
| Breaking News | `category: "news"` + `time_range: "day"` |
| Code/Tech | Append `site:github.com` or `site:docs.rs` |
| Music/Indie | Append `site:bandcamp.com` or `site:bluesky.social` |
| Academic | Append `site:edu` or `site:arxiv.org` |

---

## Setup (first use only)

Ask the user for a SearXNG instance and add to your shell profile (`~/.bashrc`, `~/.zshrc`) to persist across sessions.
