---
name: web-search
description: "Web search via SearXNG and full-page markdown extraction."
user-invocable: true
---

# Web Search & Fetch

Use **search** to find URLs and **fetch** to read full content. Always prioritize fresh data for time-sensitive queries.

## Setup

If `web-search` is not found on PATH, link it first:

```bash
cd ~/.pi/agent/git/github.com/amixaam/web-search && npm link
```

## Usage

You can call the `web-search` command directly from the shell. It accepts a single JSON string as its only argument.

### `search` Mode
- `queries`: Single string or array of strings. Each string is searched in parallel.
- `category`: `"general"` (default), `"news"`, `"images"`.
- `time_range`: `"day"`, `"week"`, `"month"`, `"year"`. (Use sparingly; best for breaking news).
- `quantity`: 1–20 (default: 4). Applies to each query.

**Example (single query):**
```bash
web-search '{"queries": "Llama 4 architecture paper", "quantity": 5}'
```

**Example (parallel queries):**
```bash
web-search '{"queries": ["Llama 4 architecture paper", "Llama 4 site:arxiv.org", "Llama 4 benchmark results"]}'
```

### `fetch` Mode
- `url`: The full address to extract content from.
- `max_length`: Character limit (default: 15,000).

**Example:**
```bash
web-search '{"fetch": "https://example.com"}'
```

---

## Core Best Practices

### 1. The "Search-then-Read" Loop
Snippet text is often SEO garbage. Use `search` to identify the best URL, then immediately use `fetch` to get the full, clean Markdown content for accurate analysis.

### 2. Parallel Queries for Multi-Perspective Searches
When researching a topic, run multiple variations in parallel for comprehensive coverage:
```bash
web-search '{"queries": [
  "RTX 5090 specs",
  "RTX 5090 release date",
  "RTX 5090 price comparison"
]}'
```

### 3. Date & Context Injection
Always include the current date in your query and use the `time_range` parameter only for breaking news or actively changing topics.
- **Bad:** `web-search '{"queries": "iPhone 17 Pro retail price", "time_range": "month"}'`
- **Good:** `web-search '{"queries": "iPhone 17 Pro retail price April 2026"}'`

### 4. Disambiguation by Exclusion
Use `-` to prune noise from common names or overlapping topics.
- **Example:** `web-search '{"queries": "Horizon game -Forbidden -Zero -Dawn"}'`

### 5. Target the "Source of Truth"
| Target | Search Strategy |
|---|---|
| **Breaking News** | Use `category: "news"` + `time_range: "day"` |
| **Code/Tech** | Append `site:github.com` or `site:docs.rs` |
| **Music/Indie** | Append `site:bandcamp.com` or `site:bluesky.social` |
| **Academic** | Append `site:edu` or `site:arxiv.org` |

---

## Examples

```json
// Find recent documentation
web-search '{"queries": "Next.js 15 partial prerendering docs"}'

// Get specific price data
web-search '{"queries": "Nvidia RTX 5090 MSRP", "category": "news", "time_range": "month"}'

// Deep read of a specific article
web-search '{"fetch": "https://www.nature.com/articles/s41586-024-00000-0"}'

// Research a topic from multiple angles (parallel)
web-search '{"queries": ["React 19 new features", "React 19 release notes", "React 19 migration guide"]}'
```
