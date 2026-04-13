# Web Search

Search the web via a SearXNG instance. Exposes two modes:

- **Search** — query SearXNG and return ranked results as JSON
- **Fetch** — grab full-page content from a single URL (prefers `/llms.txt` → markdown → HTML extraction)

## Setup

```bash
bun install

# Make sure SEARXNG_URL in index.js points to your instance
SEARXNG_URL="https://your-searxng-instance"

# Link globally so `web-search` is available as a command from anywhere
bun link
```

That's it — `bun link` creates a symlink in `~/.bun/bin/` so any edits to this repo take effect immediately.

```bash
# Unlink later if needed
bun unlink
```
