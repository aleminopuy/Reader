// RSS / Atom support. Feeds are fetched directly when the site allows it,
// otherwise through the CORS proxy set in Settings.

import { settings } from './settings.js';

async function fetchText(url) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (res.ok) return await res.text();
  } catch {
    // Most likely blocked by CORS — fall through to the proxy.
  }
  if (!settings.corsProxy) throw new Error('This site blocks direct access and no proxy is set in Settings.');
  const res = await fetch(settings.corsProxy + encodeURIComponent(url), { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Couldn't fetch feed (${res.status}).`);
  return res.text();
}

function parseXml(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  return doc.querySelector('parsererror') ? null : doc;
}

/**
 * Accepts a feed URL or a normal website URL (it will look for the site's feed).
 * Returns { url, feed } where feed = { title, siteUrl, items }.
 */
export async function discoverFeed(input) {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const text = await fetchText(url);

  const xml = parseXml(text);
  if (xml && isFeed(xml)) return { url, feed: parseFeed(xml, url) };

  // Not a feed — treat it as a web page and look for <link rel="alternate">.
  const html = new DOMParser().parseFromString(text, 'text/html');
  const link = html.querySelector(
    'link[rel~="alternate"][type="application/rss+xml"], link[rel~="alternate"][type="application/atom+xml"], link[rel~="alternate"][type="application/feed+xml"]'
  );
  if (link?.getAttribute('href')) {
    const feedUrl = new URL(link.getAttribute('href'), url).href;
    const feedXml = parseXml(await fetchText(feedUrl));
    if (feedXml && isFeed(feedXml)) return { url: feedUrl, feed: parseFeed(feedXml, feedUrl) };
  }
  throw new Error("Couldn't find an RSS or Atom feed at that address.");
}

export async function fetchFeed(url) {
  const xml = parseXml(await fetchText(url));
  if (!xml || !isFeed(xml)) throw new Error('Not a valid feed anymore.');
  return parseFeed(xml, url);
}

function isFeed(xml) {
  const root = xml.documentElement?.localName;
  return root === 'rss' || root === 'feed' || root === 'RDF';
}

// Namespace-agnostic child lookup (handles content:encoded, dc:creator, etc.)
function child(el, ...names) {
  for (const name of names) {
    for (const c of el.children) if (c.localName === name || c.nodeName === name) return c;
  }
  return null;
}
function childText(el, ...names) {
  return child(el, ...names)?.textContent.trim() || '';
}

function parseFeed(xml, feedUrl) {
  const root = xml.documentElement;
  const isAtom = root.localName === 'feed';
  const channel = isAtom ? root : child(root, 'channel') || root;
  const title = childText(channel, 'title') || new URL(feedUrl).hostname;
  const siteUrl = isAtom ? atomLink(channel) : childText(channel, 'link');

  const entries = isAtom
    ? [...root.children].filter((c) => c.localName === 'entry')
    : [...xml.getElementsByTagName('item')];

  const items = entries.map((e) => {
    const link = isAtom ? atomLink(e) : childText(e, 'link');
    const html = isAtom
      ? childText(e, 'content') || childText(e, 'summary')
      : childText(e, 'content:encoded', 'encoded') || childText(e, 'description');
    const guid = childText(e, 'guid', 'id') || link || childText(e, 'title');
    const date = Date.parse(childText(e, 'pubDate', 'published', 'updated', 'dc:date', 'date')) || Date.now();
    return {
      guid,
      title: childText(e, 'title') || '(untitled)',
      link: link ? absolutize(link, feedUrl) : '',
      author: childText(e, 'dc:creator', 'creator', 'author') || child(e, 'author')?.textContent.trim() || '',
      date,
      html,
    };
  });
  return { title, siteUrl, items };
}

function atomLink(el) {
  const links = [...el.children].filter((c) => c.localName === 'link');
  const alt = links.find((l) => !l.getAttribute('rel') || l.getAttribute('rel') === 'alternate');
  return (alt || links[0])?.getAttribute('href') || '';
}

function absolutize(href, base) {
  try { return new URL(href, base).href; } catch { return href; }
}

/** Short, stable id for a feed item. */
export function itemId(feedUrl, guid) {
  let h = 5381;
  const s = feedUrl + '\n' + guid;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return 'rss-' + h.toString(36) + '-' + s.length.toString(36);
}

export function htmlToSnippet(html, len = 180) {
  const text = new DOMParser().parseFromString(html || '', 'text/html').body.textContent || '';
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > len ? clean.slice(0, len).trimEnd() + '…' : clean;
}
