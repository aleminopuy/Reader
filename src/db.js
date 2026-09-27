// Tiny promise wrapper around IndexedDB — the offline cache.
//
// Stores:
//   messages  newsletter/feed item metadata (small; all loaded into memory)
//   bodies    { id, html, text } — loaded only when an item is opened
//   sources   per-publication settings { key, name, favorite, muted }
//   feeds     RSS subscriptions { url, title, siteUrl, lastFetched, error }
//   outbox    Gmail label changes waiting to be sent (for offline use)
//   meta      misc key/value

const NAME = 'letterbox';
const VERSION = 1;
let dbPromise;

function open() {
  dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore('messages', { keyPath: 'id' });
      d.createObjectStore('bodies', { keyPath: 'id' });
      d.createObjectStore('sources', { keyPath: 'key' });
      d.createObjectStore('feeds', { keyPath: 'url' });
      d.createObjectStore('outbox', { keyPath: 'seq', autoIncrement: true });
      d.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(store, mode, fn) {
  const d = await open();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => resolve(out instanceof IDBRequest ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const db = {
  all: (store) => run(store, 'readonly', (s) => s.getAll()),
  keys: (store) => run(store, 'readonly', (s) => s.getAllKeys()),
  get: (store, key) => run(store, 'readonly', (s) => s.get(key)),
  put: (store, value, key) => run(store, 'readwrite', (s) => { s.put(value, key); }),
  putMany: (store, values) => run(store, 'readwrite', (s) => { values.forEach((v) => s.put(v)); }),
  add: (store, value) => run(store, 'readwrite', (s) => { s.add(value); }),
  del: (store, key) => run(store, 'readwrite', (s) => { s.delete(key); }),
  delMany: (store, keys) => run(store, 'readwrite', (s) => { keys.forEach((k) => s.delete(k)); }),
  clear: (store) => run(store, 'readwrite', (s) => { s.clear(); }),
};
