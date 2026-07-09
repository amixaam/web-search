# Web Search

A [Pi](https://pi.dev/) extension and standalone CLI for source discovery through SearXNG. It returns normalized, deduplicated search results; use Obscura to render and read a selected URL.

## Install for Pi

```bash
pi install https://github.com/amixaam/web-search.git
```

The extension registers one tool: `web_search`.

## Standalone CLI

```bash
git clone https://github.com/amixaam/web-search.git
cd web-search
npm install
npm link
```

It uses `https://search.amixam.net` by default. Override it when needed:

```bash
SEARXNG_URL="https://your-searxng-instance" web-search '{"query":"SearXNG"}'
```

```bash
web-search '{"query":"latest React release notes", "quantity":5}'
web-search '{"queries":["browser automation", "web scraping"], "category":"news", "time_range":"month"}'
web-search '{"query":"Responses API", "domains":["platform.openai.com"], "language":"en"}'
```

## Search parameters

| Parameter | Default | Description |
|---|---:|---|
| `query` / `queries` | — | A query string, or an array for parallel searches. |
| `quantity` | `3` | Results per query, from 1–20. |
| `page` | `1` | First SearXNG result page to inspect. |
| `category` | `general` | Any category enabled by the SearXNG instance, such as `images`, `news`, `videos`, or `files`. |
| `time_range` | — | `day`, `week`, `month`, or `year`. |
| `language` | `all` | SearXNG language code. |
| `domains` | — | Array of allowed domains; subdomains match. |

The tool strips common tracking parameters, deduplicates URLs, and preserves available engine, publication-date, thumbnail, and image-source metadata.

## Fetch selected pages with Obscura

```bash
obscura fetch "https://selected-result.example" --wait-until networkidle0 --dump markdown --quiet
```
