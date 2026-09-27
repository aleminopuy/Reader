// "Clean view": turns a newsletter's table-soup HTML into simple, safe,
// readable markup. Everything is rebuilt from an allowlist, so no scripts,
// styles or tracking attributes survive.
//
// Tweak the patterns below if something you care about gets removed (or junk
// gets through). The "Original" button in the reader always shows the email
// exactly as sent.

// Short blocks containing these phrases are treated as boilerplate and removed.
const BOILERPLATE = new RegExp(
  [
    'unsubscribe',
    'view (this|it|the)? ?(email|newsletter|post)? ?(in|on) (your |a |the )?(web )?browser',
    'view (this )?(email )?online',
    'view in browser',
    'having trouble (viewing|reading)',
    'manage (your )?(email )?(preferences|subscription|settings)',
    'update (your )?(email )?preferences',
    'email preferences',
    "you('| a)re receiving this",
    'you received this (email|because)',
    'this email was sent to',
    'no longer (wish|want) to receive',
    'add us to your address book',
    'forwarded this email',
    'was this email forwarded',
  ].join('|'),
  'i'
);

// Link text that points to the web version of the issue.
const WEB_VERSION = /view (this |it |the )?(email |newsletter |post )?(in|on) (your |a |the )?(web )?browser|view (this )?(email |post )?online|read (it |this )?(online|on the web)|view in browser|open in (your )?browser/i;

const DROP = 'script,style,noscript,head,meta,link,title,iframe,object,embed,form,input,button,select,textarea,svg,canvas,video,audio,map,area,template';

const KEEP = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote',
  'strong', 'b', 'em', 'i', 'u', 's', 'code', 'pre', 'hr', 'br', 'figure',
  'figcaption', 'sup', 'sub', 'small', 'dl', 'dt', 'dd',
]);
let resolveBase = '';
function resolve(href) {
  if (!resolveBase) return href;
  try { return new URL(href, resolveBase).href; } catch { return href; }
}

const BLOCKISH = new Set([
  'div', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th', 'center',
  'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'caption',
]);

/**
 * @returns {{ node: DocumentFragment, webUrl: string, words: number }}
 */
export function cleanHtml(html, { images = true, base = '' } = {}) {
  resolveBase = base;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const body = doc.body;

  body.querySelectorAll(DROP).forEach((el) => el.remove());
  body.querySelectorAll('[style]').forEach((el) => {
    if (isHidden(el.getAttribute('style'))) el.remove();
  });
  body.querySelectorAll('[hidden], [aria-hidden="true"]').forEach((el) => el.remove());

  // Remember the "view in browser" link before stripping boilerplate.
  let webUrl = '';
  for (const a of body.querySelectorAll('a[href]')) {
    if (WEB_VERSION.test(a.textContent) && /^https?:/i.test(a.getAttribute('href'))) {
      webUrl = a.getAttribute('href');
      break;
    }
  }

  removeBoilerplate(doc);

  const out = document.createDocumentFragment();
  for (const n of [...body.childNodes]) convert(n, out, images);
  prune(out);
  const words = (out.textContent.match(/\S+/g) || []).length;
  return { node: out, webUrl, words };
}

/** Plain-text emails: paragraphs + clickable links. */
export function cleanText(text) {
  const out = document.createDocumentFragment();
  for (const para of text.replace(/\r\n/g, '\n').split(/\n\s*\n/)) {
    if (!para.trim()) continue;
    const p = document.createElement('p');
    const lines = para.split('\n');
    lines.forEach((line, i) => {
      linkify(line, p);
      if (i < lines.length - 1) p.appendChild(document.createElement('br'));
    });
    out.appendChild(p);
  }
  const words = (text.match(/\S+/g) || []).length;
  return { node: out, webUrl: '', words };
}

function linkify(line, parent) {
  let last = 0;
  for (const m of line.matchAll(/https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/g)) {
    parent.appendChild(document.createTextNode(line.slice(last, m.index)));
    const a = document.createElement('a');
    a.href = m[0];
    a.textContent = m[0].length > 60 ? m[0].slice(0, 57) + '…' : m[0];
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    parent.appendChild(a);
    last = m.index + m[0].length;
  }
  parent.appendChild(document.createTextNode(line.slice(last)));
}

function isHidden(style) {
  return /display\s*:\s*none|visibility\s*:\s*hidden|max-height\s*:\s*0(px)?\s*(;|!|$)|font-size\s*:\s*0(px)?\s*(;|!|$)|opacity\s*:\s*0(\.0+)?\s*(;|!|$)|mso-hide\s*:\s*all/i.test(style);
}

function removeBoilerplate(doc) {
  const doomed = new Set();
  const total = textLen(doc.body);
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (!BOILERPLATE.test(t.textContent)) continue;
    // Climb to the largest ancestor that is still "small" (a footer block),
    // but never so far that we'd swallow real content.
    let el = t.parentElement;
    while (el.parentElement && el.parentElement !== doc.body && textLen(el.parentElement) < 350) {
      el = el.parentElement;
    }
    // Never delete most of a short email just because it mentions "unsubscribe".
    if (textLen(el) < 350 && textLen(el) < total * 0.5) doomed.add(el);
  }
  doomed.forEach((el) => el.remove());
}

function textLen(el) {
  return el.textContent.replace(/\s+/g, ' ').trim().length;
}

function convert(node, parent, images) {
  if (node.nodeType === Node.TEXT_NODE) {
    parent.appendChild(document.createTextNode(node.textContent));
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const tag = node.localName;
  const style = node.getAttribute('style') || '';
  let el = null;

  if (tag === 'a') {
    const href = resolve(node.getAttribute('href') || '');
    if (/^(https?:|mailto:)/i.test(href)) {
      el = document.createElement('a');
      el.href = href;
      el.target = '_blank';
      el.rel = 'noopener noreferrer';
    }
  } else if (tag === 'img') {
    if (images) {
      const img = makeImage(node);
      if (img) parent.appendChild(img);
    }
    return;
  } else if (KEEP.has(tag)) {
    el = document.createElement(tag);
  } else if (BLOCKISH.has(tag) || tag === 'span' || tag === 'font') {
    // Newsletters often fake headings with big inline font sizes.
    const size = Number(/font-size\s*:\s*(\d+(?:\.\d+)?)px/i.exec(style)?.[1] || 0);
    const short = textLen(node) > 0 && textLen(node) < 150 && !node.querySelector('p,div,table,h1,h2,h3');
    if (short && size >= 22) el = document.createElement('h2');
    else if (short && size >= 18 && BLOCKISH.has(tag)) el = document.createElement('h3');
    else if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(style)) el = document.createElement('strong');
    else if (/font-style\s*:\s*italic/i.test(style)) el = document.createElement('em');
    else if (BLOCKISH.has(tag)) el = document.createElement('div');
    // span/font with nothing special: unwrap (children go straight to parent)
  }

  const target = el || parent;
  for (const c of [...node.childNodes]) convert(c, target, images);
  if (el) parent.appendChild(el);
}

function makeImage(node) {
  const src = resolve(node.getAttribute('src') || '');
  if (!/^https?:/i.test(src)) return null;
  const w = dim(node, 'width');
  const h = dim(node, 'height');
  // Tracking pixels, spacers and tiny social icons.
  if ((w && w <= 3) || (h && h <= 3)) return null;
  if (w && h && w <= 48 && h <= 48) return null;
  const img = document.createElement('img');
  img.src = src;
  img.alt = node.getAttribute('alt') || '';
  img.loading = 'lazy';
  img.referrerPolicy = 'no-referrer';
  if (w && w < 200) img.className = 'small';
  return img;
}

function dim(node, name) {
  const attr = parseInt(node.getAttribute(name), 10);
  if (attr) return attr;
  const m = new RegExp(`(?:^|;|\\s)${name}\\s*:\\s*(\\d+)px`, 'i').exec(node.getAttribute('style') || '');
  return m ? parseInt(m[1], 10) : 0;
}

// Remove empty wrappers and collapse div-in-div chains.
function prune(root) {
  for (const el of [...root.querySelectorAll('div, p, strong, em, b, i, a, h2, h3, li, blockquote, figure')].reverse()) {
    const hasContent = el.textContent.trim() || el.querySelector('img, hr, br');
    if (!hasContent) { el.remove(); continue; }
    if (el.localName === 'div' && el.childNodes.length === 1 && el.firstChild.localName === 'div') {
      el.replaceWith(el.firstChild);
    }
  }
  // Leading/trailing <br>s inside blocks are just noise.
  root.querySelectorAll('div, p').forEach((el) => {
    while (el.firstChild?.localName === 'br') el.firstChild.remove();
    while (el.lastChild?.localName === 'br') el.lastChild.remove();
  });
}
