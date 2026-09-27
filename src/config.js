// Defaults baked into the app. Everything here can also be changed from the
// in-app Settings screen (those values are stored per device and win).
export const CONFIG = {
  // Paste your Google OAuth "Web application" client ID here so every device
  // picks it up automatically. See README.md → "Set up Gmail access".
  clientId: '',

  // Used when a feed's website doesn't allow direct browser fetches (CORS).
  // The feed URL is appended, URL-encoded. Swap in your own Cloudflare worker
  // (tools/cors-proxy-worker.js) if you'd rather not use a public proxy.
  corsProxy: 'https://api.allorigins.win/raw?url=',
};
