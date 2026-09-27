import { CONFIG } from './config.js';

const KEY = 'lb.settings';

const DEFAULTS = {
  clientId: CONFIG.clientId,
  corsProxy: CONFIG.corsProxy,
  email: '',            // remembered Gmail address, used as a sign-in hint
  demo: false,          // use built-in sample newsletters instead of Gmail
  theme: 'auto',        // auto | light | dark | sepia | eink
  font: 'serif',        // serif | sans
  fontSize: 19,         // reader text size in px
  images: true,         // show images in clean view
  markReadOnOpen: true,
  paged: 'auto',        // auto (on in e-ink theme) | on | off
  maxMessages: 300,     // how many recent emails to keep offline
  perFeed: 50,          // how many items to keep per RSS feed
};

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
    // An empty saved value shouldn't hide a value baked into config.js.
    for (const k of ['clientId', 'corsProxy']) if (!saved[k]) delete saved[k];
    return { ...DEFAULTS, ...saved };
  } catch {
    return { ...DEFAULTS };
  }
}

export const settings = load();

export function saveSettings(patch) {
  Object.assign(settings, patch);
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {}
}

export function isPaged() {
  return settings.paged === 'on' || (settings.paged === 'auto' && settings.theme === 'eink');
}
