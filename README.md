# Web Search

Search the web via a SearXNG instance. Works as a [pi](https://pi.dev/) extension (registers `web_search` and `web_fetch` tools) and a standalone CLI.

---

## Install for Pi

```bash
pi install https://github.com/amixaam/web-search.git
```

That's it — pi discovers the extension and skill automatically. Two tools become available:

- **`web_search`** — query SearXNG, return ranked results
- **`web_fetch`** — extract full page content from a URL

**Set your SearXNG URL**:

```bash
export SEARXNG_URL="https://your-searxng-instance"
```

Or add to your shell profile (`~/.bashrc`, `~/.zshrc`, etc.) to persist. Or ask pi: *"set SEARXNG_URL in my shell profile: {url}"*.

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
