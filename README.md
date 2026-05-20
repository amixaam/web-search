# Web Search

I got tired of searching for good web search skills that didnt require some api key and money, so i decided to make my own, which used what i already have.

Search the web via a SearXNG instance. Works as a [pi](https://pi.dev/) extension (registers `web_search` and `web_fetch` tools) and a standalone CLI.

Supports sequential queries, finding llms.txt and HTML parsing into an agent friendly response on fetch.

Only requires a [SearXNG](https://github.com/searxng/searxng) instance!

---

## Install for Pi

```bash
pi install https://github.com/amixaam/web-search.git
```

Two tools become available:

- **`web_search`** — query SearXNG, return ranked results
- **`web_fetch`** — extract full page content from a URL

**Set your SearXNG URL**:

```bash
export SEARXNG_URL="https://your-searxng-instance"
```

Or add it to your shell profile to make it persist!

---

## Standalone CLI / Skill

```bash
git clone https://github.com/amixaam/web-search.git
cd web-search
npm install
npm link           # makes `web-search` available globally
```

```bash
# Search
web-search '{"queries": "Llama 4 architecture paper", "quantity": 5}'

# Multi-query (parallel)
web-search '{"queries": ["RTX 5090 specs", "RTX 5090 release date"]}'

# Deep fetch
web-search '{"fetch": "https://example.com", "max_length": 20000}'
```

Or without linking:

```bash
node index.js '{"fetch": "https://example.com"}'
```
