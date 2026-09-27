// Demo mode: a fake Gmail with made-up newsletters, so the app can be tried
// (and tweaked) without any Google setup. Same interface as gmail.js.

const day = 86_400_000;
const now = Date.now();

function newsletter({ brand, color, preheader, title, paragraphs, image }) {
  const paras = paragraphs.map((p) =>
    p.startsWith('## ')
      ? `<tr><td style="font-family:Georgia,serif;font-size:24px;font-weight:bold;padding:24px 32px 4px">${p.slice(3)}</td></tr>`
      : `<tr><td style="font-family:Georgia,serif;font-size:17px;line-height:1.6;color:#333;padding:8px 32px">${p}</td></tr>`
  ).join('');
  return `<!doctype html><html><head><style>body{margin:0;background:#eee}</style></head><body>
<div style="display:none;max-height:0;overflow:hidden">${preheader}</div>
<table width="100%" cellpadding="0" cellspacing="0" bgcolor="#eeeeee"><tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" bgcolor="#ffffff">
  <tr><td style="font-size:12px;color:#999;padding:8px 32px" align="right"><a href="https://example.com/web/${encodeURIComponent(brand)}">View this email in your browser</a></td></tr>
  <tr><td bgcolor="${color}" style="padding:24px 32px;color:#fff;font-family:Helvetica,Arial;font-size:14px;letter-spacing:2px">${brand.toUpperCase()}</td></tr>
  <tr><td style="font-family:Georgia,serif;font-size:30px;font-weight:bold;padding:24px 32px 8px">${title}</td></tr>
  ${image ? `<tr><td style="padding:8px 32px"><img src="${image}" width="536" alt=""></td></tr>` : ''}
  ${paras}
  <tr><td style="padding:24px 32px"><a href="https://example.com/share"><img src="https://example.com/twitter.png" width="24" height="24" alt="Share"></a></td></tr>
  <tr><td style="font-size:12px;color:#999;padding:16px 32px;font-family:Arial">You're receiving this because you subscribed to ${brand}.<br>
    123 Example Street, Springfield · <a href="https://example.com/unsub">Unsubscribe</a> · <a href="https://example.com/prefs">Manage preferences</a></td></tr>
</table></td></tr></table>
<img src="https://example.com/open.gif?id=123" width="1" height="1" alt="">
</body></html>`;
}

const SAMPLES = [
  {
    fromName: 'The Slow Garden', fromEmail: 'hello@slowgarden.example', age: 0.2, unread: true,
    subject: 'What to plant before the first frost',
    html: newsletter({
      brand: 'The Slow Garden', color: '#3b6e3b', preheader: 'Garlic, tulips, and a word about patience',
      title: 'What to plant before the first frost',
      paragraphs: [
        'Autumn is the most underrated planting season. The soil is still warm, the air is cool, and roots get a head start that spring plantings never quite catch up to.',
        '## Garlic goes in now',
        'Break the bulbs into cloves a day before planting and set them pointy end up, about two inches deep. Mulch heavily once the ground starts to cool — straw works, shredded leaves work better.',
        '## Bulbs for spring',
        'Tulips, daffodils and alliums all want a cold spell to bloom. A good rule: plant them three times as deep as the bulb is tall, and don\'t fuss about which way is up — they figure it out.',
        'Next week: saving seeds from this year\'s tomatoes, and why you should let a few go to rot on purpose.',
      ],
    }),
  },
  {
    fromName: 'Weekend Reading', fromEmail: 'issues@weekendreading.example', age: 1.1, unread: true,
    subject: 'Issue #112: On attention, maps, and slow mornings',
    html: newsletter({
      brand: 'Weekend Reading', color: '#8a4b2f', preheader: 'Five links worth your Saturday coffee',
      title: 'On attention, maps, and slow mornings',
      paragraphs: [
        'Good morning. This week\'s links have an accidental theme: the things we notice when we stop trying to notice everything.',
        '## 1. The case for paper maps',
        'A lovely essay on how turn-by-turn directions quietly erase our sense of place. <a href="https://example.com/maps">Read it here</a>.',
        '## 2. A year without a smartphone',
        'The author expected boredom. What they got was <em>time</em> — and a surprising amount of it spent reading long novels.',
        '## 3. Morning pages, revisited',
        'Three handwritten pages every morning, no editing. Skeptics welcome; the results are in the comments.',
      ],
    }),
  },
  {
    fromName: 'Byte Sized', fromEmail: 'digest@bytesized.example', age: 2.4, unread: false, starred: true,
    subject: 'The week in tech, minus the hype',
    html: newsletter({
      brand: 'Byte Sized', color: '#1f4e8c', preheader: 'Three stories that actually matter',
      title: 'The week in tech, minus the hype',
      paragraphs: [
        'Three stories this week, each explained in plain English, plus one tool worth trying.',
        '## Batteries keep getting better, quietly',
        'Nothing dramatic happened this week — which is the point. Year-over-year improvements in energy density keep compounding, and cheap storage is changing how power grids work.',
        '## Tool of the week',
        'A tiny command-line app that turns any folder of Markdown notes into a searchable website. Free, open-source, and refreshingly boring.',
      ],
    }),
  },
  {
    fromName: 'Trail Notes', fromEmail: 'notes@trailnotes.example', age: 4, unread: true,
    subject: 'Three easy fall hikes (and one hard one)',
    html: newsletter({
      brand: 'Trail Notes', color: '#6b5b2e', preheader: 'Leaves are turning — here is where to see them',
      title: 'Three easy fall hikes (and one hard one)',
      paragraphs: [
        'The leaves are turning early this year. Here are four trails, sorted from "bring the kids" to "bring snacks and a sense of humor."',
        '## Mill Creek Loop — 2 miles',
        'Flat, shaded, and ends at a waterfall. Perfect for a lazy Sunday.',
        '## Ridgeback Trail — 9 miles',
        'Steep switchbacks for the first three miles, then a ridge walk with views in every direction. Start early.',
      ],
    }),
  },
  {
    fromName: 'Kitchen Table', fromEmail: 'recipes@kitchentable.example', age: 6, unread: false,
    subject: 'One-pot soup season is here',
    text: `Hi friends,

Soup season is officially here, and I have a one-pot white bean and kale soup that takes 30 minutes start to finish.

You'll need: olive oil, an onion, 4 cloves of garlic, 2 cans of white beans, a bunch of kale, 6 cups of stock, and a parmesan rind if you have one.

Full recipe with photos: https://example.com/recipes/white-bean-soup

Happy cooking,
Sam

--
Unsubscribe: https://example.com/unsub`,
  },
];

const store = new Map();
SAMPLES.forEach((s, i) => {
  const id = 'demo-' + (i + 1);
  store.set(id, {
    meta: {
      id,
      origin: 'gmail',
      date: now - s.age * day,
      fromName: s.fromName,
      fromEmail: s.fromEmail,
      source: s.fromEmail,
      subject: s.subject,
      snippet: (s.text || s.html.replace(/<(style|div style="display:none)[\s\S]*?<\/(style|div)>/g, '').replace(/View this email in your browser/, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim().slice(0, 160),
      unsubscribe: 'https://example.com/unsub',
      link: '',
      inbox: true,
      unread: Boolean(s.unread),
      starred: Boolean(s.starred),
    },
    body: { id, html: s.html || '', text: s.text || '' },
  });
});

// Remember demo read/star/archive state across reloads, like Gmail would.
const FLAGS_KEY = 'lb.demoFlags';
try {
  const saved = JSON.parse(localStorage.getItem(FLAGS_KEY) || '{}');
  for (const [id, flags] of Object.entries(saved)) if (store.has(id)) Object.assign(store.get(id).meta, flags);
} catch {}
function saveFlags() {
  const out = {};
  for (const [id, { meta }] of store) out[id] = { inbox: meta.inbox, unread: meta.unread, starred: meta.starred };
  try { localStorage.setItem(FLAGS_KEY, JSON.stringify(out)); } catch {}
}

export const isConfigured = () => true;
export const isSignedIn = () => true;
export const preloadSignIn = () => {};
export const signIn = async () => {};
export const signOut = () => {};

export async function listIds(q) {
  const all = [...store.values()].map((x) => x.meta);
  if (q.includes('is:starred')) return all.filter((m) => m.starred).map((m) => m.id);
  if (q.includes('is:unread')) return all.filter((m) => m.inbox && m.unread).map((m) => m.id);
  return all.filter((m) => m.inbox).map((m) => m.id);
}

export async function getMessage(id) {
  return structuredClone(store.get(id));
}

export async function modify(id, add = [], remove = []) {
  const m = store.get(id)?.meta;
  if (!m) return;
  const map = { INBOX: 'inbox', UNREAD: 'unread', STARRED: 'starred' };
  add.forEach((l) => (m[map[l]] = true));
  remove.forEach((l) => (m[map[l]] = false));
  saveFlags();
}
