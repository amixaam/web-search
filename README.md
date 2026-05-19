# Web Search

Search the web via a SearXNG instance. Works as both a standalone CLI tool and a [pi](https://pi.dev/) skill. Two modes:

- **Search** — query SearXNG and return ranked results as JSON
- **Fetch** — grab full-page content from a single URL (prefers `/llms.txt` → markdown → HTML extraction)

---

## Install for Pi

```bash
# Install from GitHub as a pi package (recommended)
pi install https://github.com/amixaam/web-search.git

# That's it — pi discovers the skill automatically.
# It's now available via /skill:web-search or by asking pi to search the web.
```

Pi clones the repo, runs `npm install`, and picks up the skill from `SKILL.md`. Updates happen via `pi update`.

### Manual install (local clone)

```bash
git clone https://github.com/amixaam/web-search.git ~/skills/web-search
cd ~/skills/web-search
npm install

# Register with pi
pi install ~/skills/web-search
```

---

## Standalone CLI

```bash
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

# Unlink later if needed
npm unlink -g web-search
```

---

## Configuration

Set the SearXNG instance via environment variable:

```bash
export SEARXNG_URL="https://your-searxng-instance"
```



---

## Requirements

- [Node.js](https://nodejs.org) ≥ 18
- [Pi](https://pi.dev/) (for skill integration)
- A SearXNG instance (self-hosted or public)
