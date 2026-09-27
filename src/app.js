import { settings, saveSettings, isPaged } from './settings.js';
import { state, onChange, load, sync, setFlags, updateSource, sourceName, getBody, isFeedKey,
  addFeed, removeFeed, importOpml, clearMail, provider, flushOutbox } from './store.js';
import { cleanHtml, cleanText } from './clean.js';
import { icons } from './icons.js';
import { db } from './db.js';

const $ = (sel, root = document) => root.querySelector(sel);
const main = $('#main');
const sidebar = $('#sidebar');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const VIEWS = {
  unread: { title: 'Unread', filter: (m) => m.inbox && m.unread, hideMuted: true },
  all: { title: 'Inbox', filter: (m) => m.inbox, hideMuted: true },
  saved: { title: 'Saved', filter: (m) => m.starred },
  archive: { title: 'Archive', filter: (m) => !m.inbox },
};

let lastListHash = '#/view/unread';
let contextIds = [];   // the list the current item was opened from (for Next / Prev)
let cursor = -1;       // keyboard selection in lists
let readerKeys = null; // page-turn handler while an item is open

// ================================================================ routing

function route() {
  const [, name = 'view', ...rest] = location.hash.split('/');
  return { name, arg: decodeURIComponent(rest.join('/') || '') };
}

async function render() {
  applyTheme();
  renderTopbar();
  renderSidebar();
  readerKeys = null;
  const r = route();
  document.body.classList.toggle('reading', r.name === 'read');
  if (r.name === 'read') return renderReader(r.arg);
  if (r.name === 'settings') return renderSettings();
  if (r.name === 'feeds') return renderFeeds();
  lastListHash = location.hash || '#/view/unread';
  renderList(r);
}

// Re-render lists when data changes, but never yank an open article away.
onChange(() => {
  renderTopbar();
  renderSidebar();
  const r = route();
  if (r.name === 'view' || r.name === 'source') renderList(r, { keepScroll: true });
});

window.addEventListener('hashchange', () => {
  closeDrawer();
  render();
  if (route().name !== 'read') main.scrollTop = 0;
});

// ================================================================ chrome

function applyTheme() {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  root.dataset.font = settings.font;
  root.style.setProperty('--reader-size', settings.fontSize + 'px');
  document.body.classList.toggle('eink', settings.theme === 'eink');
}

function renderTopbar() {
  const r = route();
  $('#title').textContent = r.name === 'read' ? '' : 'Letterbox';

  const btn = $('#syncBtn');
  btn.classList.toggle('spinning', state.syncing);
  btn.disabled = state.syncing;
  $('#status').textContent = state.progress || statusText();
}

function statusText() {
  if (!navigator.onLine) return 'Offline';
  if (!state.lastSync) return '';
  const mins = Math.round((Date.now() - state.lastSync) / 60000);
  if (mins < 1) return 'Up to date';
  if (mins < 60) return `Updated ${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return hrs < 24 ? `Updated ${hrs}h ago` : `Updated ${Math.round(hrs / 24)}d ago`;
}

function visible(m, view) {
  if (view.hideMuted && state.sources.get(m.source)?.muted) return false;
  return view.filter(m);
}

function renderSidebar() {
  const r = route();
  const counts = new Map();
  let unreadTotal = 0;
  for (const m of state.messages) {
    if (m.inbox && m.unread) {
      counts.set(m.source, (counts.get(m.source) || 0) + 1);
      if (!state.sources.get(m.source)?.muted) unreadTotal++;
    }
  }
  const sourcesWithItems = new Set(state.messages.map((m) => m.source));
  const all = [...state.sources.values()].filter((s) => sourcesWithItems.has(s.key) || isFeedKey(s.key));
  const sorted = all.sort((a, b) => (a.muted - b.muted) || a.name.localeCompare(b.name));

  const navItem = (hash, label, count, active, cls = '') => `
    <a href="${esc(hash)}" class="nav-item ${active ? 'active' : ''} ${cls}">
      <span class="nav-label">${esc(label)}</span>${count ? `<span class="badge">${count}</span>` : ''}
    </a>`;
  const srcItem = (s) => navItem('#/source/' + encodeURIComponent(s.key), s.name, counts.get(s.key),
    r.name === 'source' && r.arg === s.key, s.muted ? 'muted' : '');

  const favs = sorted.filter((s) => s.favorite);
  const letters = sorted.filter((s) => !s.favorite && !isFeedKey(s.key));
  const feeds = sorted.filter((s) => !s.favorite && isFeedKey(s.key));

  sidebar.innerHTML = `
    <div class="nav-group">
      ${navItem('#/view/unread', 'Unread', unreadTotal, r.name === 'view' && r.arg === 'unread')}
      ${navItem('#/view/all', 'Inbox', 0, r.name === 'view' && r.arg === 'all')}
      ${navItem('#/view/saved', 'Saved', state.messages.filter((m) => m.starred).length, r.name === 'view' && r.arg === 'saved')}
      ${navItem('#/view/archive', 'Archive', 0, r.name === 'view' && r.arg === 'archive')}
    </div>
    ${favs.length ? `<div class="nav-head">Favorites</div><div class="nav-group">${favs.map(srcItem).join('')}</div>` : ''}
    ${letters.length ? `<div class="nav-head">Newsletters</div><div class="nav-group">${letters.map(srcItem).join('')}</div>` : ''}
    <div class="nav-head">Feeds</div>
    <div class="nav-group">
      ${feeds.map(srcItem).join('')}
      ${navItem('#/feeds', '+ Add or manage feeds', 0, r.name === 'feeds', 'subtle')}
    </div>
    <div class="nav-group nav-bottom">${navItem('#/settings', 'Settings', 0, r.name === 'settings', 'subtle')}</div>`;
}

function openDrawer() { document.body.classList.add('drawer-open'); }
function closeDrawer() { document.body.classList.remove('drawer-open'); }
$('#menuBtn').innerHTML = icons.menu;
$('#menuBtn').addEventListener('click', () => document.body.classList.toggle('drawer-open'));
$('#scrim').addEventListener('click', closeDrawer);
$('#syncBtn').innerHTML = icons.sync;
$('#syncBtn').addEventListener('click', () => doSync(true));
$('#settingsBtn').innerHTML = icons.settings;

// ================================================================ sync

async function doSync(fromTap = false) {
  const p = provider();
  if (fromTap && p.isConfigured() && !p.isSignedIn()) {
    try {
      await p.signIn();
    } catch (e) {
      toast(e.message);
      if (!state.feeds.length) return;
    }
  }
  const errors = await sync();
  if (errors.length) {
    const auth = errors.find((e) => e.name === 'Error' && /sign/i.test(e.message));
    toast(auth ? auth.message : errors.length === 1 ? errors[0].message : `${errors.length} problems while syncing — see Feeds.`);
  } else if (fromTap) {
    toast('Up to date');
  }
}

// ================================================================ lists

function listFor(r) {
  if (r.name === 'source') {
    return { title: state.sources.get(r.arg)?.name || 'Publication',
      items: state.messages.filter((m) => m.source === r.arg), source: r.arg };
  }
  const view = VIEWS[r.arg] || VIEWS.unread;
  return { title: view.title, items: state.messages.filter((m) => visible(m, view)), view: r.arg || 'unread' };
}

function fmtDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const opts = { month: 'short', day: 'numeric' };
  if (d.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString([], opts);
}

function renderList(r, { keepScroll = false } = {}) {
  const top = main.scrollTop;
  const { title, items, source, view } = listFor(r);
  contextIds = items.map((m) => m.id);
  cursor = Math.min(cursor, items.length - 1);

  const src = source && state.sources.get(source);
  const feed = source && isFeedKey(source) && state.feeds.find((f) => 'feed:' + f.url === source);
  const unreadHere = items.filter((m) => m.unread && m.inbox);

  main.innerHTML = `
    ${banner()}
    <div class="list-head">
      <h2>${esc(title)}</h2>
      <div class="list-actions">
        ${src ? `
          <button data-act="fav" class="chip ${src.favorite ? 'on' : ''}">${src.favorite ? '★ Favorite' : '☆ Favorite'}</button>
          <button data-act="rename" class="chip">Rename</button>
          <button data-act="mute" class="chip ${src.muted ? 'on' : ''}">${src.muted ? 'Muted' : 'Mute'}</button>
          ${feed?.siteUrl ? `<a class="chip" href="${esc(feed.siteUrl)}" target="_blank" rel="noopener">Website</a>` : ''}` : ''}
        ${unreadHere.length ? `<button data-act="allread" class="chip">Mark all read</button>` : ''}
      </div>
    </div>
    ${src?.muted ? `<p class="hint">Muted: this publication is hidden from Unread and Inbox.</p>` : ''}
    ${items.length ? `<ul class="items">${items.map(itemRow).join('')}</ul>` : emptyState(view, source)}
    ${settings.theme === 'eink' && items.length > 6 ? `
      <div class="list-pager">
        <button data-act="pgup" aria-label="Page up">${icons.up}</button>
        <button data-act="pgdn" aria-label="Page down">${icons.down}</button>
      </div>` : ''}`;
  if (keepScroll) main.scrollTop = top;
  highlightCursor();

  main.onclick = async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    const m = state.messages.find((x) => x.id === el.closest('[data-id]')?.dataset.id);
    if (act === 'star' && m) setFlags(m, { starred: !m.starred });
    if (act === 'fav') updateSource(source, { favorite: !src.favorite });
    if (act === 'mute') updateSource(source, { muted: !src.muted });
    if (act === 'rename') {
      const name = prompt('Show this publication as:', src.name);
      if (name?.trim()) updateSource(source, { name: name.trim() });
    }
    if (act === 'allread' && confirm(`Mark ${unreadHere.length} item(s) as read?`)) setFlags(unreadHere, { unread: false });
    if (act === 'pgup') main.scrollBy(0, -main.clientHeight * 0.9);
    if (act === 'pgdn') main.scrollBy(0, main.clientHeight * 0.9);
    if (act === 'signin') doSync(true);
    if (act === 'demo') { saveSettings({ demo: true }); await clearMail(); doSync(); }
  };
}

function itemRow(m) {
  return `
    <li class="item ${m.unread ? 'unread' : ''} ${m.inbox ? '' : 'archived'}" data-id="${esc(m.id)}">
      <a class="item-main" href="#/read/${encodeURIComponent(m.id)}">
        <div class="item-meta">
          <span class="item-src">${esc(sourceName(m))}</span>
          <span class="item-date">${esc(fmtDate(m.date))}</span>
        </div>
        <div class="item-subject">${esc(m.subject)}</div>
        <div class="item-snippet">${esc(m.snippet)}</div>
      </a>
      <button class="icon-btn item-star ${m.starred ? 'on' : ''}" data-act="star" aria-label="${m.starred ? 'Unsave' : 'Save for later'}">
        ${m.starred ? icons.starFilled : icons.star}
      </button>
    </li>`;
}

function banner() {
  const p = provider();
  if (!settings.demo && !p.isConfigured()) {
    return `
      <div class="card welcome">
        <h3>Welcome to Letterbox</h3>
        <p>Your newsletters and RSS feeds, in one calm place.</p>
        <p>To read newsletters from Gmail, add your Google client ID in <a href="#/settings">Settings</a>
        (the README walks you through it, about 10 minutes). You can add
        <a href="#/feeds">RSS feeds</a> right away, or look around with sample newsletters first.</p>
        <div class="row"><button class="btn" data-act="demo">Try with sample newsletters</button>
        <a class="btn secondary" href="#/feeds">Add an RSS feed</a></div>
      </div>`;
  }
  if (!settings.demo && !p.isSignedIn()) {
    return `
      <div class="card signin">
        <span>Sign in to Gmail to get new newsletters.${state.messages.length ? ' You can still read what’s saved offline.' : ''}</span>
        <button class="btn" data-act="signin">Sign in</button>
      </div>`;
  }
  return '';
}

function emptyState(view, source) {
  if (source) return `<p class="empty">Nothing here yet.</p>`;
  if (view === 'unread') return `<p class="empty">All caught up. ☕</p>`;
  if (view === 'saved') return `<p class="empty">Nothing saved. Tap the star on anything you want to keep.</p>`;
  return `<p class="empty">Nothing here.</p>`;
}

function highlightCursor() {
  main.querySelectorAll('.item.cursor').forEach((el) => el.classList.remove('cursor'));
  const el = main.querySelectorAll('.item')[cursor];
  if (el) {
    el.classList.add('cursor');
    el.scrollIntoView({ block: 'nearest' });
  }
}

// ================================================================ reader

async function renderReader(id) {
  const m = state.messages.find((x) => x.id === id);
  if (!m) {
    main.innerHTML = `<p class="empty">That item isn’t in the offline cache anymore. <a href="${esc(lastListHash)}">Back</a></p>`;
    return;
  }
  if (!contextIds.includes(id)) contextIds = listFor(parseHash(lastListHash)).items.map((x) => x.id);
  if (settings.markReadOnOpen && m.unread) setFlags(m, { unread: false });

  const body = (await getBody(id)) || { html: '', text: '' };
  if (route().arg !== id) return; // user navigated away while loading

  const isRss = m.origin === 'rss';
  const original = !isRss && m.viewOriginal === true;
  const cleaned = body.html
    ? cleanHtml(body.html, { images: settings.images, base: m.link })
    : cleanText(body.text || m.snippet);
  const webUrl = m.link || cleaned.webUrl;
  const minutes = Math.max(1, Math.round(cleaned.words / 230));
  const idx = contextIds.indexOf(id);
  const nextId = contextIds[idx + 1];
  const prevId = idx > 0 ? contextIds[idx - 1] : null;
  const paged = isPaged() && !original;

  main.innerHTML = `
    <article class="reader ${paged ? 'paged' : ''}">
      <div class="reader-bar">
        <button class="icon-btn" data-act="back" aria-label="Back">${icons.back}</button>
        <span class="spacer"></span>
        <button class="icon-btn ${m.starred ? 'on' : ''}" data-act="star" title="Save for later (s)">${m.starred ? icons.starFilled : icons.star}</button>
        <button class="icon-btn" data-act="unread" title="${m.unread ? 'Mark read' : 'Mark unread'} (m)">${m.unread ? icons.mailOpen : icons.mail}</button>
        <button class="icon-btn" data-act="archive" title="${m.inbox ? 'Archive (e)' : 'Move to inbox'}">${m.inbox ? icons.archive : icons.unarchive}</button>
        ${!isRss && body.html ? `<button class="chip" data-act="mode" title="Toggle clean / original (v)">${original ? 'Clean' : 'Original'}</button>` : ''}
        <button class="chip" data-act="smaller" aria-label="Smaller text">A−</button>
        <button class="chip" data-act="bigger" aria-label="Bigger text">A+</button>
      </div>
      <div class="reader-scroll">
        <div class="reader-content">
          <header class="reader-head">
            <a class="reader-src" href="#/source/${encodeURIComponent(m.source)}">${esc(sourceName(m))}</a>
            <h1>${esc(m.subject)}</h1>
            <div class="reader-meta">${esc(new Date(m.date).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }))}
              ${m.author ? ` · ${esc(m.author)}` : ''} · ${minutes} min read</div>
          </header>
          <div class="reader-body"></div>
          <footer class="reader-foot">
            ${nextId ? `<a class="btn" href="#/read/${encodeURIComponent(nextId)}">Next: ${esc(state.messages.find((x) => x.id === nextId)?.subject || '')} →</a>`
              : `<a class="btn" href="${esc(lastListHash)}">Back to list</a>`}
            <div class="row">
              ${webUrl ? `<a class="chip" href="${esc(webUrl)}" target="_blank" rel="noopener">${isRss ? 'Open article' : 'Open on web'} ${icons.external}</a>` : ''}
              ${m.unsubscribe ? `<a class="chip" href="${esc(m.unsubscribe)}" target="_blank" rel="noopener">Unsubscribe</a>` : ''}
            </div>
          </footer>
        </div>
      </div>
      ${paged ? `<div class="pager">
        <button class="icon-btn" data-act="pgprev" aria-label="Previous page">${icons.prev}</button>
        <span class="page-num"></span>
        <button class="icon-btn" data-act="pgnext" aria-label="Next page">${icons.next}</button>
      </div>` : ''}
    </article>`;

  const bodyEl = $('.reader-body', main);
  if (original) {
    const frame = document.createElement('iframe');
    frame.className = 'original';
    // No allow-scripts: the email can't run code. allow-same-origin only lets us measure its height.
    frame.setAttribute('sandbox', 'allow-same-origin allow-popups allow-popups-to-escape-sandbox');
    frame.srcdoc = '<base target="_blank">' + body.html;
    frame.onload = () => {
      const doc = frame.contentDocument;
      const fit = () => { frame.style.height = doc.documentElement.scrollHeight + 'px'; };
      fit();
      new ResizeObserver(fit).observe(doc.body);
    };
    bodyEl.appendChild(frame);
  } else {
    bodyEl.appendChild(cleaned.node);
  }
  main.scrollTop = 0;

  const pager = paged ? setupPaging() : null;

  const go = (targetId) => { if (targetId) location.hash = '#/read/' + encodeURIComponent(targetId); };
  const actions = {
    back: () => { location.hash = lastListHash; },
    star: () => setFlags(m, { starred: !m.starred }).then(render),
    unread: () => setFlags(m, { unread: !m.unread }).then(render),
    archive: async () => {
      const wasInbox = m.inbox;
      await setFlags(m, { inbox: !m.inbox });
      if (wasInbox) {
        toast('Archived');
        nextId ? go(nextId) : actions.back();
      } else {
        render();
      }
    },
    mode: () => { m.viewOriginal = !original; render(); },
    smaller: () => { saveSettings({ fontSize: Math.max(13, settings.fontSize - 1) }); applyTheme(); pager?.relayout(); },
    bigger: () => { saveSettings({ fontSize: Math.min(32, settings.fontSize + 1) }); applyTheme(); pager?.relayout(); },
    pgprev: () => pager?.turn(-1),
    pgnext: () => pager?.turn(1),
    next: () => go(nextId),
    prev: () => go(prevId),
  };
  main.onclick = (e) => {
    const el = e.target.closest('[data-act]');
    if (el && actions[el.dataset.act]) actions[el.dataset.act]();
  };
  readerKeys = actions;
}

function parseHash(hash) {
  const [, name = 'view', ...rest] = hash.split('/');
  return { name, arg: decodeURIComponent(rest.join('/') || '') };
}

/** E-ink friendly page turning: lays the article out in screen-sized columns. */
function setupPaging() {
  const scroller = $('.reader-scroll', main);
  const content = $('.reader-content', main);
  const GAP = 48;
  let page = 0;
  let pages = 1;

  const step = () => scroller.clientWidth + GAP;
  const show = () => {
    scroller.scrollLeft = page * step();
    $('.page-num', main).textContent = `${page + 1} / ${pages}`;
  };
  const count = () => {
    pages = Math.max(1, Math.ceil((scroller.scrollWidth - 1) / step()));
    page = Math.min(page, pages - 1);
    show();
  };
  const relayout = () => {
    const ratio = pages > 1 ? page / (pages - 1) : 0;
    content.style.height = scroller.clientHeight + 'px';
    content.style.columnWidth = scroller.clientWidth + 'px';
    content.style.columnGap = GAP + 'px';
    pages = Math.max(1, Math.ceil((scroller.scrollWidth - 1) / step()));
    page = Math.round(ratio * (pages - 1));
    show();
  };
  const turn = (dir) => {
    const target = page + dir;
    if (target < 0) return;
    if (target >= pages) {
      const next = $('.reader-foot a.btn', main);
      if (next) location.hash = next.getAttribute('href');
      return;
    }
    page = target;
    show();
  };

  relayout();
  content.querySelectorAll('img').forEach((img) => img.addEventListener('load', count));
  // Tap the left third of the page to go back, anywhere else to go forward.
  scroller.addEventListener('click', (e) => {
    if (e.target.closest('a, button')) return;
    const x = e.clientX - scroller.getBoundingClientRect().left;
    turn(x < scroller.clientWidth / 3 ? -1 : 1);
  });
  let startX = null;
  scroller.addEventListener('touchstart', (e) => { startX = e.touches[0].clientX; }, { passive: true });
  scroller.addEventListener('touchend', (e) => {
    if (startX === null) return;
    const dx = e.changedTouches[0].clientX - startX;
    startX = null;
    if (Math.abs(dx) > 50) { e.preventDefault(); turn(dx < 0 ? 1 : -1); }
  });
  window.addEventListener('resize', relayout);
  const cleanup = new MutationObserver(() => {
    if (!document.contains(scroller)) { window.removeEventListener('resize', relayout); cleanup.disconnect(); }
  });
  cleanup.observe(main, { childList: true });
  return { turn, relayout };
}

// ================================================================ feeds page

function renderFeeds() {
  main.innerHTML = `
    <div class="page">
      <h2>RSS feeds</h2>
      <form class="card" id="addFeed">
        <label for="feedUrl">Feed or website address</label>
        <div class="row">
          <input id="feedUrl" type="url" inputmode="url" placeholder="e.g. example.com/blog or example.com/feed.xml" required>
          <button class="btn" type="submit">Add</button>
        </div>
        <p class="hint">Paste a feed URL, or just a site’s address and Letterbox will look for its feed.</p>
      </form>

      ${state.feeds.length ? `<ul class="feed-list">${state.feeds.map((f) => `
        <li>
          <div class="feed-info">
            <a href="#/source/${encodeURIComponent('feed:' + f.url)}"><strong>${esc(state.sources.get('feed:' + f.url)?.name || f.title)}</strong></a>
            <div class="hint">${esc(f.url)}</div>
            ${f.error ? `<div class="error">⚠ ${esc(f.error)}</div>` : ''}
          </div>
          <button class="chip" data-remove="${esc(f.url)}">Remove</button>
        </li>`).join('')}</ul>` : `<p class="empty">No feeds yet.</p>`}

      <div class="card">
        <strong>Moving from another RSS reader?</strong>
        <p class="hint">Import an OPML file (most readers can export one).</p>
        <input type="file" id="opml" accept=".opml,.xml,text/xml,application/xml">
      </div>
    </div>`;

  $('#addFeed').onsubmit = async (e) => {
    e.preventDefault();
    const input = $('#feedUrl');
    const btn = e.submitter || $('#addFeed button');
    btn.disabled = true;
    btn.textContent = 'Adding…';
    try {
      const feed = await addFeed(input.value);
      toast(`Added ${feed.title}`);
      renderFeeds();
    } catch (err) {
      toast(err.message);
      btn.disabled = false;
      btn.textContent = 'Add';
    }
  };
  $('#opml').onchange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const { added, failed } = await importOpml(await file.text(), toast);
    toast(`Imported ${added} feed(s)` + (failed.length ? `, ${failed.length} failed` : ''));
    renderFeeds();
  };
  main.onclick = async (e) => {
    const url = e.target.closest('[data-remove]')?.dataset.remove;
    if (url && confirm('Remove this feed and its saved items?')) {
      await removeFeed(url);
      renderFeeds();
    }
  };
}

// ================================================================ settings

function renderSettings() {
  const p = provider();
  const opt = (value, label, current) => `<option value="${value}" ${String(current) === String(value) ? 'selected' : ''}>${label}</option>`;
  main.innerHTML = `
    <div class="page settings">
      <h2>Settings</h2>

      <section class="card">
        <h3>Gmail</h3>
        ${settings.demo
          ? `<p>Showing <strong>sample newsletters</strong>. Turn this off to use your real Gmail.</p>`
          : p.isSignedIn()
            ? `<p>Signed in as <strong>${esc(settings.email)}</strong>.</p>`
            : `<p>${p.isConfigured() ? 'Not signed in.' : 'Not set up yet. See the README for the 10-minute setup.'}</p>`}
        <label>Google OAuth client ID
          <input name="clientId" value="${esc(settings.clientId)}" placeholder="1234-abc.apps.googleusercontent.com" autocomplete="off" spellcheck="false">
        </label>
        <div class="row">
          ${!settings.demo && p.isConfigured() && !p.isSignedIn() ? `<button class="btn" data-act="signin">Sign in</button>` : ''}
          ${!settings.demo && settings.email ? `<button class="btn secondary" data-act="signout">Sign out</button>` : ''}
        </div>
        <label class="check"><input type="checkbox" name="demo" ${settings.demo ? 'checked' : ''}> Use sample newsletters (demo)</label>
      </section>

      <section class="card">
        <h3>Look</h3>
        <label>Theme
          <select name="theme">
            ${opt('auto', 'Match system', settings.theme)}${opt('light', 'Light', settings.theme)}
            ${opt('sepia', 'Sepia', settings.theme)}${opt('dark', 'Dark', settings.theme)}
            ${opt('eink', 'E-ink (Boox)', settings.theme)}
          </select>
        </label>
        <label>Reading font
          <select name="font">${opt('serif', 'Serif', settings.font)}${opt('sans', 'Sans-serif', settings.font)}</select>
        </label>
        <label>Text size <span class="hint">${settings.fontSize}px</span>
          <input type="range" name="fontSize" min="13" max="32" value="${settings.fontSize}">
        </label>
      </section>

      <section class="card">
        <h3>Reading</h3>
        <label>Page turning
          <select name="paged">
            ${opt('auto', 'Automatic (on for e-ink theme)', settings.paged)}
            ${opt('on', 'Always turn pages', settings.paged)}
            ${opt('off', 'Always scroll', settings.paged)}
          </select>
        </label>
        <label class="check"><input type="checkbox" name="images" ${settings.images ? 'checked' : ''}> Show images in clean view</label>
        <label class="check"><input type="checkbox" name="markReadOnOpen" ${settings.markReadOnOpen ? 'checked' : ''}> Mark as read when opened</label>
        <label>Emails to keep offline
          <select name="maxMessages">${[100, 200, 300, 500, 1000].map((n) => opt(n, n, settings.maxMessages)).join('')}</select>
        </label>
        <label>Items to keep per RSS feed
          <select name="perFeed">${[20, 50, 100, 200].map((n) => opt(n, n, settings.perFeed)).join('')}</select>
        </label>
      </section>

      <section class="card">
        <h3>RSS</h3>
        <label>CORS proxy (used only when a site blocks direct access)
          <input name="corsProxy" value="${esc(settings.corsProxy)}" spellcheck="false">
        </label>
        <p class="hint">The feed address is added to the end. See <code>tools/cors-proxy-worker.js</code> to run your own for free.</p>
      </section>

      <section class="card">
        <h3>Keyboard shortcuts</h3>
        <p class="hint"><kbd>j</kbd>/<kbd>k</kbd> next/previous · <kbd>o</kbd> or <kbd>Enter</kbd> open · <kbd>u</kbd> back ·
        <kbd>s</kbd> save · <kbd>e</kbd> archive · <kbd>m</kbd> read/unread · <kbd>v</kbd> original · <kbd>r</kbd> refresh ·
        <kbd>Space</kbd>/<kbd>←</kbd><kbd>→</kbd> turn pages</p>
      </section>

      <section class="card">
        <h3>Data</h3>
        <p class="hint">${state.messages.length} items stored on this device. Read/saved/archived state for emails syncs through Gmail; for RSS items it stays on this device.</p>
        <button class="btn secondary" data-act="wipe">Clear offline cache</button>
      </section>
    </div>`;

  main.onchange = async (e) => {
    const { name, type, checked, value } = e.target;
    if (!name) return;
    const val = type === 'checkbox' ? checked : ['fontSize', 'maxMessages', 'perFeed'].includes(name) ? Number(value) : value.trim();
    const before = settings[name];
    saveSettings({ [name]: val });
    if (name === 'demo' && before !== val) {
      await clearMail();
      if (val) doSync();
    }
    if (name === 'clientId') provider().preloadSignIn();
    render();
  };
  main.oninput = (e) => {
    if (e.target.name === 'fontSize') {
      settings.fontSize = Number(e.target.value);
      applyTheme();
      e.target.previousElementSibling.textContent = settings.fontSize + 'px';
    }
  };
  main.onclick = async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'signin') { await doSync(true); render(); }
    if (act === 'signout') { provider().signOut(); render(); }
    if (act === 'wipe' && confirm('Delete everything stored on this device? (Your Gmail is not touched. Feed subscriptions are removed.)')) {
      await Promise.all(['messages', 'bodies', 'sources', 'feeds', 'outbox', 'meta'].map((s) => db.clear(s)));
      await load();
      toast('Cache cleared');
      render();
    }
  };
}

// ================================================================ keyboard

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
  const r = route();
  if (r.name === 'read' && readerKeys) {
    const map = {
      j: 'next', n: 'next', k: 'prev', p: 'prev', u: 'back', Escape: 'back',
      s: 'star', e: 'archive', m: 'unread', v: 'mode',
    };
    const paged = document.querySelector('.reader.paged');
    if (paged && ['ArrowRight', ' ', 'PageDown'].includes(e.key)) { e.preventDefault(); return readerKeys.pgnext(); }
    if (paged && ['ArrowLeft', 'PageUp'].includes(e.key)) { e.preventDefault(); return readerKeys.pgprev(); }
    if (map[e.key]) { e.preventDefault(); readerKeys[map[e.key]](); }
    return;
  }
  if (r.name === 'view' || r.name === 'source') {
    const rows = main.querySelectorAll('.item');
    const m = state.messages.find((x) => x.id === rows[cursor]?.dataset.id);
    if (e.key === 'j') { cursor = Math.min(cursor + 1, rows.length - 1); highlightCursor(); }
    else if (e.key === 'k') { cursor = Math.max(cursor - 1, 0); highlightCursor(); }
    else if ((e.key === 'o' || e.key === 'Enter') && m) location.hash = '#/read/' + encodeURIComponent(m.id);
    else if (e.key === 's' && m) setFlags(m, { starred: !m.starred });
    else if (e.key === 'e' && m) setFlags(m, { inbox: !m.inbox });
    else if (e.key === 'm' && m) setFlags(m, { unread: !m.unread });
    else return;
    e.preventDefault();
  }
  if (e.key === 'r' && r.name !== 'read') doSync(true);
});

// ================================================================ misc

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

window.addEventListener('online', () => { renderTopbar(); flushOutbox().catch(() => {}); });
window.addEventListener('offline', renderTopbar);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - state.lastSync > 15 * 60_000) autoSync();
});
setInterval(renderTopbar, 60_000);

function autoSync() {
  if (!navigator.onLine) return;
  if (provider().isSignedIn() || state.feeds.length) sync().catch(() => {});
}

async function start() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.storage?.persist?.().catch(() => {});
  provider().preloadSignIn();
  await load();
  if (!location.hash) history.replaceState(null, '', '#/view/unread');
  render();
  autoSync();
}

start();
