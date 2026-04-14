/**
 * HTML → LLM-optimized markdown extractor
 * Supports two extraction paths:
 *   1. Readability (via @mozilla/readability + jsdom) — battle-tested, clean
 *   2. Custom node-html-parser fallback — lighter, no extra deps for content
 */

import { parse } from 'node-html-parser';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';

const NOISE_TAGS = new Set([
  'script', 'style', 'noscript', 'iframe', 'svg', 'link',
  'meta', 'nav', 'header', 'footer', 'aside', 'button',
  'form', 'input', 'select', 'textarea', 'label',
  'canvas', 'video', 'audio', 'source', 'track', 'embed',
]);

// Expanded noise patterns — catches more sidebar/nav/class noise
const NOISE_RE = /menu|sidebar|hamburger|ticker|breadcrumb|cookie|popup|modal|overlay|toolbar|chat-widget|social-share|fake-terminal|separator|sr-only|visually-hidden|ft-hint|nav-|menu-|sidebar-|toc|table-of-contents|related-?posts?|author-|byline|comment-|reply-|share-|rating|ad-|advertisement|promo|banner|skip|dropdown|accordion|tab-|pager|pagination|skip-link|back-to-top/i;

// Content-bearing role/class patterns to KEEP (even if they match above)
const CONTENT_ROLE_RE = /article|main|content|prose|post|entry|body|story/i;

function isNoiseNode(node) {
  if (!node?.tagName) return false;
  const tag = node.tagName.toLowerCase();
  if (NOISE_TAGS.has(tag)) return true;

  const cls = node.getAttribute('class') || '';
  const id = node.getAttribute('id') || '';
  const role = node.getAttribute('role') || '';

  const isNoise = NOISE_RE.test(cls) || NOISE_RE.test(id);
  const isContent = CONTENT_ROLE_RE.test(cls) || CONTENT_ROLE_RE.test(id);

  // role=navigation is usually nav noise, but role=main is content
  if (role && /navigation|complementary|banner|contentinfo/i.test(role)) {
    if (!isContent) return true;
  }

  return isNoise && !isContent;
}

function findContentNode(root) {
  // Try semantic elements first
  const candidates = [
    root.querySelector('main'),
    root.querySelector('[role=main]'),
    root.querySelector('article'),
    root.querySelector('[role=article]'),
  ];

  for (const el of candidates) {
    if (el?.textContent?.trim().length > 100) return el;
  }

  // Try class/id heuristics
  const heuristics = [
    '[class*=article]', '[class*=post]', '[class*=entry]',
    '[class*=content]', '[class*=prose]', '[class*=story]',
    '[id*=article]', '[id*=post]', '[id*=content]',
  ];

  for (const sel of heuristics) {
    const el = root.querySelector(sel);
    if (el?.textContent?.trim().length > 200) {
      const cls = el.getAttribute('class') || '';
      const id = el.getAttribute('id') || '';
      if (!NOISE_RE.test(cls) && !NOISE_RE.test(id)) return el;
    }
  }

  // Fallback: prefer <body> over the full document root
  // (root may include <head> which pollutes extraction)
  const body = root.querySelector('body');
  if (body?.textContent?.trim().length > 50) return body;

  return root;
}

function findTitle(root) {
  // Try OpenGraph title first (often cleaner)
  const og = root.querySelector('meta[property=og:title]');
  if (og) {
    const t = og.getAttribute('content')?.trim();
    if (t) return t;
  }
  return root.querySelector('title')?.textContent?.trim() || '';
}

function ws(s) { return (s || '').replace(/\u00A0/g, ' ').replace(/\r?\n/g, ' ').replace(/\t/g, ' ').replace(/  +/g, ' ').trim(); }

function collectRaw(children) {
  return (children || []).map(c =>
    c.nodeType === 3 ? (c.text || '') : collectRaw(c.childNodes || [])
  ).join('');
}

function collectInline(children) {
  const parts = (children || []).map(c => {
    if (c.nodeType === 3) return (c.text || '').replace(/\r?\n/g, ' ');
    const t = (c.tagName || '').toLowerCase();
    if (t === 'code') return '`' + ws(collectRaw(c.childNodes)) + '`';
    if (t === 'a') {
      const href = c.getAttribute('href') || '';
      const txt = ws(collectInline(c.childNodes));
      return href && !href.startsWith('#') ? '[' + txt + '](' + href + ')' : txt;
    }
    if (t === 'strong' || t === 'b') return '**' + ws(collectInline(c.childNodes)) + '**';
    if (t === 'em' || t === 'i') return '*' + ws(collectInline(c.childNodes)) + '*';
    if (t === 'br') return '  ';  // two spaces = hard line break in markdown
    // passthrough inline elements
    if ('sub sup abbr cite var time data del ins mark kbd q u small span strong b em i code a'.split(' ').includes(t)) {
      return collectInline(c.childNodes || []);
    }
    return '';
  }).join('');
  return ws(parts);
}

// ── Table helpers ──────────────────────────────────────────────────────────────

function parseTable(tableNode) {
  const rows = [];
  const headers = [];
  let hasHeader = false;

  const tbody = tableNode.querySelector('tbody') || tableNode;
  const trs = (tbody.querySelectorAll('tr'));

  if (!trs.length) return '';

  for (let i = 0; i < trs.length; i++) {
    const tr = trs[i];
    const cells = [];

    // Check for th in this row
    const ths = tr.querySelectorAll('th');
    const tds = tr.querySelectorAll('td');
    const rowCells = ths.length ? ths : tds;

    for (const cell of rowCells) {
      const text = ws(collectInline(cell.childNodes));
      cells.push(text);
    }

    if (cells.some(c => c.length > 0)) {
      if (ths.length) {
        headers.push(...cells);
        hasHeader = true;
      } else {
        rows.push(cells);
      }
    }
  }

  if (!rows.length && !headers.length) return '';

  // Normalize column widths
  const allCols = hasHeader ? [headers, ...rows] : rows;
  const colCount = Math.max(...allCols.map(r => r.length));

  const lines = [];

  // Header row
  const headerRow = headers.length
    ? headers.slice(0, colCount).concat(Array(colCount - headers.length).fill(''))
    : Array(colCount).fill('');

  if (hasHeader && headerRow.some(c => c)) {
    lines.push('| ' + headerRow.join(' | ') + ' |');
    lines.push('| ' + Array(colCount).fill('---').join(' | ') + ' |');
  }

  // Data rows
  for (const row of rows) {
    const normalized = row.slice(0, colCount).concat(Array(colCount - row.length).fill(''));
    lines.push('| ' + normalized.join(' | ') + ' |');
  }

  return lines.join('\n');
}

// ── Main converter ─────────────────────────────────────────────────────────────

function toMarkdown(node, depth = 0) {
  if (!node?.nodeType) return '';

  // Skip DOCTYPE and comment nodes
  if (node.nodeType === 10 || node.nodeType === 8) return '';  // 10=DOCTYPE, 8=comment

  if (node.nodeType === 3) {
    // node-html-parser reports DOCTYPE as text node — filter it out
    const text = (node.text || '').replace(/\r?\n/g, ' ').trim();
    if (/^<!doctype/i.test(text) || /^<!dtd/i.test(text)) return '';
    return text;
  }

  const tag = (node.tagName || '').toLowerCase();

  // Skip noise nodes
  if (NOISE_TAGS.has(tag) || tag === 'svg' || tag === 'path') return '';
  if (isNoiseNode(node)) return '';

  // Headings
  const hm = tag.match(/^h([1-6])$/);
  if (hm) {
    const lvl = parseInt(hm[1]);
    const txt = collectInline(node.childNodes);
    // Adjust depth relative to surrounding content
    const adjusted = Math.min(lvl + Math.max(0, depth - 1), 6);
    return txt ? '\n' + '#'.repeat(adjusted) + ' ' + txt + '\n' : '';
  }

  // Paragraphs
  if (tag === 'p') {
    const txt = collectInline(node.childNodes);
    return txt ? '\n' + txt + '\n' : '';
  }

  // Code blocks (<pre><code>)
  if (tag === 'pre') {
    const codeEl = node.querySelector('code') || node;
    const rawClass = codeEl.getAttribute('class') || '';
    // Extract language from class: language-js, lang-js, highlight-js, etc.
    const lang = rawClass.match(/(?:^| )lang(?:uage)?[-:]?(\b[a-z0-9_.-]+\b)/i)?.[1] ?? '';
    let code = collectRaw(codeEl.childNodes || []);
    // Strip any inner HTML tags
    code = code.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
    return code ? '\n```' + lang + '\n' + code + '\n```\n' : '';
  }

  // Inline code
  if (tag === 'code') {
    // Only treat as inline if NOT inside a <pre> (parent handles it)
    const parent = node.parentNode;
    if (parent?.tagName?.toLowerCase() === 'pre') return '';
    const txt = collectInline(node.childNodes);
    return txt ? '`' + txt + '`' : '';
  }

  // Images
  if (tag === 'img') {
    const alt = ws(node.getAttribute('alt') || '');
    const src = node.getAttribute('src') || '';
    const title = node.getAttribute('title');
    if (!src) return '';
    if (alt) return '\n![' + alt + ']' + (title ? ' (' + title + ')' : '') + '(' + src + ')\n';
    if (title) return '\n![' + title + '](' + src + ')\n';
    return '';
  }

  // Lists
  if (tag === 'ul' || tag === 'ol') {
    const inner = node.childNodes || [];
    const items = inner
      .filter(c => c.nodeType !== 3 || c.text.trim())
      .map(c => toMarkdown(c, depth))
      .join('')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return items ? '\n' + items + '\n' : '';
  }

  if (tag === 'li') {
    const parent = node.parentNode;
    const isOrdered = parent?.tagName?.toLowerCase() === 'ol';
    const marker = isOrdered ? '1.' : '-';
    const parts = (node.childNodes || []).map(c => toMarkdown(c, depth + 1));
    let txt = parts.join('').replace(/\n+/g, ' ').replace(/  +/g, ' ').trim();

    // If the <li> contains nested <ul>/<ol>, preserve them
    const nested = (node.childNodes || []).map(c => toMarkdown(c, depth + 1)).join('');

    // Check if we have nested list content after the first text part
    const firstLineEnd = nested.indexOf('\n');
    if (firstLineEnd !== -1) {
      // Has nested structure — use just the marker, let nested content flow
      txt = '';
    }

    if (txt) {
      return marker + ' ' + txt + '\n';
    } else {
      // Just nested content, no leading text
      return nested;
    }
  }

  // Definition lists
  if (tag === 'dl') {
    return (node.childNodes || []).map(c => toMarkdown(c, depth)).join('').trim() + '\n';
  }
  if (tag === 'dt') {
    const txt = collectInline(node.childNodes);
    return txt ? '\n**' + txt + '**\n' : '';
  }
  if (tag === 'dd') {
    const txt = ws(collectInline(node.childNodes));
    return txt ? '  ' + txt + '\n' : '';
  }

  // Tables
  if (tag === 'table') {
    const parsed = parseTable(node);
    return parsed ? '\n' + parsed + '\n' : '';
  }

  // Blockquote
  if (tag === 'blockquote') {
    const inner = (node.childNodes || []).map(c => toMarkdown(c, depth)).join('').trim();
    if (!inner) return '';
    return '\n> ' + inner.replace(/\n/g, '\n> ') + '\n';
  }

  // Horizontal rule
  if (tag === 'hr') return '\n---\n';

  // Line break
  if (tag === 'br') return '  \n';

  // Figure + figcaption
  if (tag === 'figure') {
    const inner = (node.childNodes || []).map(c => toMarkdown(c, depth)).join('').replace(/\n{3,}/g, '\n\n').trim();
    return inner ? '\n' + inner + '\n' : '';
  }
  if (tag === 'figcaption') {
    const txt = collectInline(node.childNodes);
    return txt ? '*' + txt + '*' : '';
  }

  // Details / summary (collapsible content)
  if (tag === 'details') {
    const inner = (node.childNodes || []).map(c => toMarkdown(c, depth)).join('').replace(/\n{3,}/g, '\n\n').trim();
    return inner ? '\n' + inner + '\n' : '';
  }
  if (tag === 'summary') {
    const txt = collectInline(node.childNodes);
    return txt ? '**' + txt + '**\n' : '';
  }

  // Abbreviated elements
  if (tag === 'abbr') {
    const title = node.getAttribute('title');
    const txt = collectInline(node.childNodes);
    return title ? txt + ' (' + title + ')' : txt;
  }
  if (tag === 'kbd') {
    return '`' + ws(collectInline(node.childNodes)) + '`';
  }

  // Block containers — recurse and normalize spacing
  if ('div section article main aside details summary figure'.split(' ').includes(tag)) {
    // When inside a top-level content container, skip noise elements
    if (depth === 0 && ('nav aside footer'.split(' ').includes(tag))) {
      const children = node.childNodes || [];
      const nonNoise = children.filter(c => {
        const t = (c.tagName || '').toLowerCase();
        if (NOISE_TAGS.has(t)) return false;
        const cls = c.getAttribute('class') || '';
        const id = c.getAttribute('id') || '';
        // Skip nav elements that look like TOC (lots of links)
        if (t === 'nav' && (cls.includes('toc') || id.includes('toc') || c.querySelectorAll('a').length > 5)) return false;
        return true;
      });
      if (nonNoise.length === 0) return '';
    }
    const inner = (node.childNodes || []).map(c => toMarkdown(c, depth)).join('').replace(/\n{3,}/g, '\n\n').trim();
    return inner ? '\n' + inner + '\n' : '';
  }

  // HR inside other elements
  if (tag === 'hr') return '\n---\n';

  // Default: recurse
  return (node.childNodes || []).map(c => toMarkdown(c, depth)).join('');
}

// ── Post-processing cleanup ────────────────────────────────────────────────────

function cleanMarkdown(body) {
  let lines = body.split('\n');

  // Remove trailing whitespace from each line
  lines = lines.map(l => l.trimEnd());

  // Remove duplicate blank lines (more than 2 consecutive)
  let out = [];
  let blankCount = 0;
  for (const line of lines) {
    if (line === '') {
      blankCount++;
      if (blankCount <= 2) out.push(line);
    } else {
      blankCount = 0;
      out.push(line);
    }
  }

  body = out.join('\n');

  // Fix punctuation directly attached to formatting markers
  body = body.replace(/(\*\*|\*)\s+([.,;:!?)\]])/g, '$1$2');
  body = body.replace(/\s+(\*\*|\*)$/gm, '$1');

  // Trim overall
  return body.trim();
}

// ── Readability extraction path ───────────────────────────────────────────────

/**
 * Extract content using Mozilla's Readability algorithm.
 * Returns { title, byline, content, siteName } or null if no content found.
 */
function extractViaReadability(html, baseUrl) {
  try {
    // JSDOM needs a full document — provide a base URL for relative links
    const dom = new JSDOM(html, { url: baseUrl });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    if (!article || !article.content) return null;
    return {
      title: article.title || '',
      byline: article.byline || '',
      content: article.content,
      siteName: article.siteName || '',
      length: article.length || 0,
    };
  } catch (err) {
    return null;
  }
}

// ── Truncation helper ─────────────────────────────────────────────────────────

/**
 * Truncate markdown to a maximum character count.
 * Tries to break at a safe boundary (blank line) to avoid cutting mid-sentence.
 * Returns { content, truncated, originalLength }.
 */
function truncateMarkdown(markdown, maxLength) {
  if (!markdown || markdown.length <= maxLength) {
    return { content: markdown, truncated: false, originalLength: markdown?.length ?? 0 };
  }

  // Try to break at a blank line boundary first
  let cutoff = markdown.lastIndexOf('\n\n', maxLength);
  if (cutoff < maxLength * 0.6) {
    // No good blank line — find the last sentence boundary
    cutoff = markdown.lastIndexOf('. ', maxLength);
    if (cutoff < maxLength * 0.5) {
      // No sentence boundary either — break at the last space
      cutoff = markdown.lastIndexOf(' ', maxLength);
    }
  }

  if (cutoff <= 0) cutoff = maxLength;

  const content = markdown.slice(0, cutoff).trimEnd();
  return {
    content,
    truncated: true,
    originalLength: markdown.length,
  };
}


// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Convert HTML to markdown.
 *
 * Options:
 *   useReadability  — try Readability first, fall back to custom parser.
 *                    Default: false (custom parser only, for backward compat).
 *   maxLength       — truncate output to this many chars. Default: Infinity.
 *   preferReadability — if true, Readability is tried first and custom parser
 *                       is the fallback. Default: true when useReadability is true.
 */
export function htmlToMarkdown(html, options = {}) {
  const {
    useReadability = true,
    maxLength = Infinity,
  } = options;

  // Attempt Readability if allowed and available
  if (useReadability) {
    const rd = extractViaReadability(html, 'https://example.com');
    if (rd && rd.content) {
      const articleMarkdown = htmlToMarkdownFromNode(rd.content, rd.title);
      const { content, truncated, originalLength } = truncateMarkdown(articleMarkdown, maxLength);
      return {
        content,
        source: 'readability',
        title: rd.title,
        byline: rd.byline,
        siteName: rd.siteName,
        charCount: originalLength,
        truncated,
        extractionMethod: 'readability',
      };
    }
  }

  // Fall back to custom parser
  const { content: body, title } = htmlToMarkdownCustom(html);
  const { content, truncated, originalLength } = truncateMarkdown(body, maxLength);
  return {
    content,
    source: 'custom-parser',
    title,
    byline: null,
    siteName: null,
    charCount: originalLength,
    truncated,
    extractionMethod: 'custom',
  };
}

/**
 * Internal: convert any HTML string to markdown using the custom parser.
 * Returns { content, title }.
 */
function htmlToMarkdownCustom(html) {
  const root = parse(html);
  const contentNode = findContentNode(root);
  const title = findTitle(root);

  let body = toMarkdown(contentNode);
  body = cleanMarkdown(body);

  // Remove duplicate title heading from body
  if (title) {
    const escaped = title.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
    body = body.replace(new RegExp('^#\\s+' + escaped + '\\n\\n?', 'i'), '');
    const titlePrefix = title.split(' - ')[0];
    if (titlePrefix && titlePrefix !== title) {
      body = body.replace(new RegExp('^#\\s+' + titlePrefix.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&') + '\\n\\n?', 'i'), '');
    }
  }

  return {
    content: title ? '# ' + title + '\n\n' + body : body,
    title,
  };
}

/**
 * Internal: convert an HTML string (already extracted content) to markdown.
 * Used by the Readability path where we already have clean HTML.
 */
function htmlToMarkdownFromNode(htmlContent, readabilityTitle) {
  // Wrap in a minimal document so node-html-parser can parse it
  const wrapped = `<html><head><title>${readabilityTitle || ''}</title></head><body>${htmlContent}</body></html>`;
  const root = parse(wrapped);

  // For Readability output, we use body as the content node
  const body = root.querySelector('body') || root;
  const title = readabilityTitle || findTitle(root);

  // Readability output is already clean — no need for aggressive noise filtering
  // but still run through toMarkdown to convert HTML elements to markdown
  let bodyMarkdown = toMarkdown(body);
  bodyMarkdown = cleanMarkdown(bodyMarkdown);

  // Remove the title heading since Readability already gives us a clean title
  if (title) {
    const escaped = title.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
    bodyMarkdown = bodyMarkdown.replace(new RegExp('^#\\s+' + escaped + '\\n\\n?', 'i'), '');
    const titlePrefix = title.split(' - ')[0];
    if (titlePrefix && titlePrefix !== title) {
      bodyMarkdown = bodyMarkdown.replace(new RegExp('^#\\s+' + titlePrefix.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&') + '\\n\\n?', 'i'), '');
    }
  }

  return title ? '# ' + title + '\n\n' + bodyMarkdown : bodyMarkdown;
}