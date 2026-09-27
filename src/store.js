// App data: loads the offline cache, syncs Gmail + RSS, and applies
// read / save / archive changes (queued while offline, sent to Gmail later).

import { db } from './db.js';
import { settings } from './settings.js';
import * as gmail from './gmail.js';
import * as demo from './demo.js';
import { discoverFeed, fetchFeed, itemId, htmlToSnippet } from './feeds.js';

export const provider = () => (settings.demo ? demo : gmail);

export const state = {
  messages: [],          // newest first
  sources: new Map(),    // key → { key, name, favorite, muted }
  feeds: [],
  syncing: false,
  progress: '',
  lastSync: 0,
};

const listeners = new Set();
export const onChange = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((fn) => fn());

export async function load() {
  const [messages, sources, feeds, lastSync] = await Promise.all([
    db.all('messages'), db.all('sources'), db.all('feeds'), db.get('meta', 'lastSync'),
  ]);
  state.messages = messages.sort((a, b) => b.date - a.date);
  state.sources = new Map(sources.map((s) => [s.key, s]));
  state.feeds = feeds.sort((a, b) => a.title.localeCompare(b.title));
  state.lastSync = lastSync || 0;
  emit();
}

export const getBody = (id) => db.get('bodies', id);
export const isFeedKey = (key) => key.startsWith('feed:');

export function sourceName(m) {
  return state.sources.get(m.source)?.name || m.fromName || m.source;
}

// ---------------------------------------------------------------- sync

export async function sync() {
  if (state.syncing) return [];
  state.syncing = true;
  state.progress = 'Syncing…';
  emit();
  const errors = [];
  try {
    const p = provider();
    if (p.isConfigured() && p.isSignedIn()) {
      try { await syncMail(p); } catch (e) { errors.push(e); }
    }
    if (state.feeds.length) await syncFeeds(errors);
    if (!errors.length) {
      state.lastSync = Date.now();
      await db.put('meta', state.lastSync, 'lastSync');
    }
  } finally {
    state.syncing = false;
    state.progress = '';
    await load();
  }
  return errors;
}

async function syncMail(p) {
  await flushOutbox();
  const max = settings.maxMessages;
  const [inbox, unread, starred] = await Promise.all([
    p.listIds('in:inbox', max),
    p.listIds('is:unread in:inbox', max),
    p.listIds('is:starred', 500),
  ]);
  const inboxSet = new Set(inbox);
  const unreadSet = new Set(unread);
  const starredSet = new Set(starred);

  const cached = new Map(state.messages.filter((m) => m.origin === 'gmail').map((m) => [m.id, m]));
  const missing = [...new Set([...inbox, ...starred])].filter((id) => !cached.has(id));

  // Download new emails.
  const fresh = [];
  let done = 0;
  await pool(missing, 5, async (id) => {
    const { meta, body } = await p.getMessage(id);
    await db.put('bodies', body);
    fresh.push(meta);
    state.progress = `Downloading ${++done} of ${missing.length}…`;
    emit();
  });

  // Update read/saved/archived state of emails we already had.
  const truncated = inbox.length >= max;
  const listedDates = inbox.map((id) => cached.get(id)?.date).filter(Boolean);
  const oldestListed = listedDates.length ? Math.min(...listedDates) : 0;
  const changed = [];
  const gone = [];
  for (const m of cached.values()) {
    const inInbox = inboxSet.has(m.id);
    if (!inInbox && !starredSet.has(m.id) && truncated && m.date < oldestListed) {
      gone.push(m.id); // fell outside the offline window
      continue;
    }
    const next = {
      inbox: inInbox,
      unread: inInbox ? unreadSet.has(m.id) : m.unread,
      starred: starredSet.has(m.id),
    };
    if (next.inbox !== m.inbox || next.unread !== m.unread || next.starred !== m.starred) {
      changed.push(Object.assign(m, next));
    }
  }

  // Keep the archive from growing forever: the newest 100 archived emails stay.
  const archived = [...cached.values()]
    .filter((m) => !m.inbox && !m.starred && !gone.includes(m.id))
    .sort((a, b) => b.date - a.date);
  gone.push(...archived.slice(100).map((m) => m.id));

  for (const meta of fresh) {
    if (!state.sources.has(meta.source)) {
      const src = { key: meta.source, name: meta.fromName, favorite: false, muted: false };
      state.sources.set(src.key, src);
      await db.put('sources', src);
    }
  }
  await db.putMany('messages', [...fresh, ...changed]);
  if (gone.length) {
    await db.delMany('messages', gone);
    await db.delMany('bodies', gone);
  }
}

async function syncFeeds(errors) {
  let done = 0;
  await pool(state.feeds, 4, async (feed) => {
    try {
      const parsed = await fetchFeed(feed.url);
      await storeItems(feed, parsed.items, false);
      feed.error = '';
      feed.lastFetched = Date.now();
    } catch (e) {
      feed.error = e.message;
      errors.push(new Error(`${feed.title}: ${e.message}`));
    }
    await db.put('feeds', feed);
    state.progress = `Checking feeds ${++done} of ${state.feeds.length}…`;
    emit();
  });
}

async function pool(items, size, fn) {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  });
  await Promise.all(workers);
}

// ---------------------------------------------------------------- actions

let flushing = null;

/** Send queued label changes to Gmail. Safe to call any time. */
export function flushOutbox() {
  flushing ||= (async () => {
    try {
      const p = provider();
      if (!p.isSignedIn()) return;
      const items = (await db.all('outbox')).sort((a, b) => a.seq - b.seq);
      for (const item of items) {
        try {
          await p.modify(item.msgId, item.add, item.remove);
        } catch (e) {
          if (e.status !== 400 && e.status !== 404) throw e; // keep for later
        }
        await db.del('outbox', item.seq);
      }
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

/** patch: any of { unread, starred, inbox } */
export async function setFlags(msgs, patch) {
  msgs = [].concat(msgs);
  for (const m of msgs) Object.assign(m, patch);
  await db.putMany('messages', msgs);
  emit();

  const labels = { unread: 'UNREAD', starred: 'STARRED', inbox: 'INBOX' };
  const add = [], remove = [];
  for (const [k, v] of Object.entries(patch)) (v ? add : remove).push(labels[k]);
  const mail = msgs.filter((m) => m.origin === 'gmail');
  for (const m of mail) await db.add('outbox', { msgId: m.id, add, remove });
  if (mail.length) flushOutbox().catch(() => {}); // stays queued if offline
}

export async function updateSource(key, patch) {
  const src = state.sources.get(key) || { key, name: key, favorite: false, muted: false };
  Object.assign(src, patch);
  state.sources.set(key, src);
  await db.put('sources', src);
  emit();
}

// ---------------------------------------------------------------- feeds

export async function addFeed(input) {
  const { url, feed } = await discoverFeed(input);
  return saveNewFeed(url, feed);
}

async function saveNewFeed(url, parsed) {
  if (state.feeds.some((f) => f.url === url)) throw new Error('You already follow that feed.');
  const feed = { url, title: parsed.title, siteUrl: parsed.siteUrl, lastFetched: Date.now(), error: '' };
  await db.put('feeds', feed);
  await db.put('sources', { key: 'feed:' + url, name: parsed.title, favorite: false, muted: false });
  await storeItems(feed, parsed.items, true);
  await load();
  return feed;
}

/** Import an OPML file exported from another RSS reader. */
export async function importOpml(text, onProgress) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const urls = [...doc.querySelectorAll('outline[xmlUrl]')].map((o) => o.getAttribute('xmlUrl'));
  let added = 0;
  const failed = [];
  for (const [i, url] of urls.entries()) {
    onProgress?.(`Importing ${i + 1} of ${urls.length}…`);
    if (state.feeds.some((f) => f.url === url)) continue;
    try {
      await saveNewFeed(url, await fetchFeed(url));
      added++;
    } catch {
      failed.push(url);
    }
  }
  return { added, failed };
}

export async function removeFeed(url) {
  const key = 'feed:' + url;
  const ids = state.messages.filter((m) => m.source === key).map((m) => m.id);
  await db.delMany('messages', ids);
  await db.delMany('bodies', ids);
  await db.del('feeds', url);
  await db.del('sources', key);
  await load();
}

async function storeItems(feed, items, initial) {
  const key = 'feed:' + feed.url;
  const existing = state.messages.filter((m) => m.source === key);
  const have = new Set(existing.map((m) => m.id));
  const newest = [...items].sort((a, b) => b.date - a.date).slice(0, settings.perFeed);

  const metas = [], bodies = [];
  newest.forEach((item, i) => {
    const id = itemId(feed.url, item.guid);
    if (have.has(id)) return;
    have.add(id);
    metas.push({
      id,
      origin: 'rss',
      date: item.date,
      fromName: feed.title,
      fromEmail: '',
      source: key,
      subject: item.title,
      snippet: htmlToSnippet(item.html),
      link: item.link,
      author: item.author,
      unsubscribe: '',
      inbox: true,
      // When first subscribing, don't dump a whole backlog into Unread.
      unread: initial ? i < 5 : true,
      starred: false,
    });
    bodies.push({ id, html: item.html, text: '' });
  });
  await db.putMany('bodies', bodies);
  await db.putMany('messages', metas);

  // Keep only the newest N items per feed (saved items are always kept).
  const all = [...existing, ...metas].sort((a, b) => b.date - a.date);
  const drop = all.slice(settings.perFeed).filter((m) => !m.starred).map((m) => m.id);
  if (drop.length) {
    await db.delMany('messages', drop);
    await db.delMany('bodies', drop);
  }
}

// ---------------------------------------------------------------- housekeeping

/** Forget all cached email (e.g. when switching between demo and real Gmail). */
export async function clearMail() {
  const ids = state.messages.filter((m) => m.origin === 'gmail').map((m) => m.id);
  await db.delMany('messages', ids);
  await db.delMany('bodies', ids);
  await db.clear('outbox');
  const mailSources = [...state.sources.keys()].filter((k) => !isFeedKey(k));
  await db.delMany('sources', mailSources);
  await db.put('meta', 0, 'lastSync');
  await load();
}
