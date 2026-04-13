/**
 * HTML → LLM-optimized markdown extractor
 * Uses node-html-parser for reliable DOM querying.
 * Zero external API calls, no token waste.
 */

import { parse } from "node-html-parser";

const NOISE_TAGS = new Set([
  "script","style","noscript","iframe","svg","link",
  "meta","nav","header","footer","aside",
]);
const NOISE_RE = /menu|sidebar|hamburger|ticker|breadcrumb|cookie|popup|modal|overlay|toolbar|chat-widget|social-share|fake-terminal|separator|sr-only|visually-hidden|ft-hint/i;

function findContentNode(root) {
  const main = root.querySelector("main");
  if (main?.textContent?.trim().length > 50) return main;
  const art = root.querySelector("article");
  if (art?.textContent?.trim().length > 50) return art;
  const contentNode = root.querySelector('[class*="content"],[id*="content"],[class*="article"],[class*="prose"]');
  if (contentNode?.textContent?.trim().length > 100) {
    const cls = contentNode.getAttribute("class") || "";
    const id = contentNode.getAttribute("id") || "";
    if (!NOISE_RE.test(cls) && !NOISE_RE.test(id)) return contentNode;
  }
  return root;
}

function findTitle(root) {
  return root.querySelector("title")?.textContent.trim() || "";
}

function ws(s) { return (s || "").replace(/\s+/g, " ").trim(); }

function collectRaw(children) {
  return (children || []).map(c =>
    c.nodeType === 3 ? (c.text || "") : collectRaw(c.childNodes || [])
  ).join("");
}

function collectInline(children) {
  const parts = (children || []).map(c => {
    if (c.nodeType === 3) return (c.text || "").replace(/\n/g, " ");
    const t = (c.tagName || "").toLowerCase();
    if (t === "code") return "`" + ws(collectRaw(c.childNodes)) + "`";
    if (t === "a") {
      const href = c.getAttribute("href") || "";
      const txt = ws(collectInline(c.childNodes));
      return href && !href.startsWith("#") ? "[" + txt + "](" + href + ")" : txt;
    }
    if (t === "strong" || t === "b") return "**" + ws(collectInline(c.childNodes)) + "**";
    if (t === "em" || t === "i") return "*" + ws(collectInline(c.childNodes)) + "*";
    if (t === "br") return "    ";  // 4 spaces to survive collapse
    if ("sub sup abbr cite var time data del ins mark kbd q u small span".split(" ").includes(t)) {
      return collectInline(c.childNodes || []);
    }
    return "";
  }).join("");  // join preserving original whitespace
  return ws(parts);  // normalize the final result
}

function toMarkdown(node, depth = 0) {
  if (!node?.nodeType || node.nodeType === 8) return "";

  if (node.nodeType === 3) {
    // Don't trim whitespace — it's meaningful for inline spacing
    const t = (node.text || "").replace(/\n/g, " ");
    return t;
  }

  const tag = (node.tagName || "").toLowerCase();
  const ch = node.childNodes || [];

  if (NOISE_TAGS.has(tag) || tag === "svg" || tag === "path") return "";
  if (typeof node.getAttribute === "function") {
    const cls = node.getAttribute("class") || "";
    const id = node.getAttribute("id") || "";
    if (NOISE_RE.test(cls) || NOISE_RE.test(id)) return "";
  }

  // Headings
  const hm = tag.match(/^h([1-6])$/);
  if (hm) {
    const lvl = parseInt(hm[1]);
    const txt = collectInline(ch);
    return txt ? "\n" + "#".repeat(Math.min(lvl + Math.max(0, depth - 1), 6)) + " " + txt + "\n" : "";
  }

  // Paragraphs
  if (tag === "p") {
    const txt = collectInline(ch);
    return txt ? "\n" + txt + "\n" : "";
  }

  // Code blocks
  if (tag === "pre") {
    const codeEl = node.querySelector("code");
    const lang = codeEl ? (codeEl.getAttribute("class") || "").match(/language-(\w+)/)?.[1] ?? "" : "";
    let code = collectRaw((codeEl || node).childNodes || []);
    code = code.replace(/<[^>]+>/g, "").trim();
    return code ? "\n```" + lang + "\n" + code + "\n```\n" : "";
  }

  // Inline code
  if (tag === "code") {
    const txt = collectInline(ch);
    return txt ? "`" + txt + "`" : "";
  }

  // Links
  if (tag === "a") {
    const href = node.getAttribute("href") || "";
    if (!href || href.startsWith("#")) return collectInline(ch);
    const txt = collectInline(ch);
    return txt || href ? " [" + txt + "](" + href + ") " : "";
  }

  // Images
  if (tag === "img") {
    const alt = node.getAttribute("alt") || "";
    const src = node.getAttribute("src") || "";
    return alt ? "\n![alt](" + src + ")\n" : "";
  }

  // Lists
  if (tag === "ul" || tag === "ol") {
    const txt = ch
      .filter(c => c.nodeType !== 3 || c.text.trim())  // skip whitespace-only text nodes
      .map(c => toMarkdown(c, depth))
      .join("")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return txt ? "\n" + txt + "\n" : "";
  }
  if (tag === "li") {
    const parts = ch.map(c => toMarkdown(c, depth));
    const txt = parts.join("")
      .replace(/\n+/g, " ")
      .replace(/  +/g, " ")
      .trim();
    return txt ? "- " + txt + "\n" : "";
  }

  // Tables
  if (tag === "table") {
    const txt = ch.map(c => toMarkdown(c, depth)).join("").trim();
    return txt ? "\n" + txt + "\n" : "";
  }
  if (tag === "tr") {
    const cells = ch.filter(c => c.tagName === "TH" || c.tagName === "TD").map(c => c.textContent.trim());
    return cells.length ? "| " + cells.join(" | ") + " |\n" : "";
  }

  // Bold / italic
  if (tag === "strong" || tag === "b") {
    const txt = collectInline(ch);
    return txt ? "**" + txt + "**" : "";
  }
  if (tag === "em" || tag === "i") {
    const txt = collectInline(ch);
    return txt ? "*" + txt + "*" : "";
  }

  // Blockquote
  if (tag === "blockquote") {
    const txt = ch.map(c => toMarkdown(c, depth)).join("").trim();
    return txt ? "\n> " + txt.replace(/\n/g, "\n> ") + "\n" : "";
  }

  if (tag === "hr") return "\n---\n";
  if (tag === "br") return "\n";

  // Definition list
  if (tag === "dl") {
    const txt = ch.map(c => toMarkdown(c, depth)).join("").trim();
    return txt ? "\n" + txt + "\n" : "";
  }
  if (tag === "dt") {
    const txt = collectInline(ch);
    return txt ? "\n**" + txt + "**\n" : "";
  }
  if (tag === "dd") {
    const txt = ws(collectInline(ch));
    return txt ? "\n  " + txt + "\n" : "";
  }

  // Block containers
  if ("div section article main figure figcaption details summary".split(" ").includes(tag)) {
    const txt = ch.map(c => toMarkdown(c, depth)).join("").replace(/\n{3,}/g, "\n\n").trim();
    return txt ? "\n" + txt + "\n" : "";
  }

  // Default: recurse
  return ch.map(c => toMarkdown(c, depth)).join("");
}

export function htmlToMarkdown(html) {
  const root = parse(html);
  const contentNode = findContentNode(root);
  const title = findTitle(root);

  let body = toMarkdown(contentNode)
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // Clean up spacing
  body = body.split("\n").map(line => {
    line = line.replace(/  +/g, " ");
    line = line.replace(/(\*\*|\*)\s+([.,;:!?)])/g, "$1$2");
    line = line.replace(/(\]\))[a-zA-Z]/g, "$1 $2");
    line = line.replace(/(\]\))(\[)/g, "$1 $2");
    line = line.replace(/\s+(\]\))/g, "$1");
    line = line.replace(/\s+([.,;:!?)])/g, "$1");
    return line;
  }).join("\n").trim();

  // If the first heading in the body duplicates the page title, remove it
  if (title) {
    body = body.replace(/^#\s+[^\n]+\n\n/, (match, offset) => {
      // Only remove if it's the very first line of the body
      if (offset === 0) return "";
      return match;
    });
  }

  return title ? "# " + title + "\n\n" + body : body;
}
