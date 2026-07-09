---
name: web-search
description: "Discover web sources through SearXNG as normalized JSON results."
user-invocable: true
---

# Web Search

Use `web_search` to discover current sources. It only returns search results and does not fetch webpages.

## Parameters

| Parameter | Default | Description |
|---|---:|---|
| `queries` | — | Required string or string array for parallel queries. |
| `quantity` | `3` | Results per query, 1–20. |
| `page` | `1` | First results page to inspect. |
| `category` | `general` | An enabled SearXNG category. |
| `time_range` | — | `day`, `week`, `month`, or `year`. |
| `language` | `all` | SearXNG language code. |
| `domains` | — | Domains to include; subdomains match. |

Results include `title`, `url`, and `content`, plus available engine, publication-date, thumbnail, and image-source metadata. URLs are canonicalized and deduplicated.
