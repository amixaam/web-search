---
name: web-search
description: "Discover web sources through SearXNG as normalized JSON results. Use Obscura to fetch selected URLs."
user-invocable: true
---

# Web Search

Use `web_search` to discover current sources. It does not fetch webpages; use Obscura to render and extract a selected result URL.

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

## Read a selected page

```bash
obscura fetch "https://selected-result.example" --wait-until networkidle0 --dump markdown --quiet
```
