# Letterbox

A calm, Google Reader–style app for reading your **newsletters** and **RSS feeds**
somewhere other than your inbox. It works on Android, Mac and a Boox e-reader.

- Newsletters arrive at a dedicated Gmail address, and Letterbox shows them grouped by publication.
- **Clean view** strips the clutter: footers, "view in browser" links, tracking pixels and layout tables. **Original** shows the email exactly as it was sent.
- Unread, saved (starred) and archive, just like Gmail. For emails, that state syncs through Gmail, so your phone, Mac and Boox all agree.
- Add **RSS/Atom feeds**. Paste a feed URL or just a site's address, or import OPML from another reader.
- **E-ink theme** for the Boox: pure black and white, no animation, and page-turning instead of scrolling (tap the right side of the page or swipe).
- Favorite, rename or mute publications.
- **Works offline.** Recent items are stored on each device, and changes you make offline are sent to Gmail when you're back online.
- No server, no account, no cost. It's plain HTML/CSS/JavaScript with no build step, so it's easy to tweak.

> Want to look around first? Open the app and tap **Try with sample newsletters**.

---

## 1. Run it

The app is published automatically to **https://aleminopuy.github.io/Reader/**. Every push to `main` runs `.github/workflows/pages.yml`, which copies the app files to the `gh-pages` branch, and GitHub Pages serves that branch. No repo settings are needed (the repo just has to be public, or on a paid GitHub plan).

**Running locally** (for tweaking): `npx serve -l 8000 .` or `python3 -m http.server 8000`, then open http://localhost:8000.

## 2. Set up the newsletter inbox

1. Create a **new Gmail account** just for newsletters, e.g. `yourname.reads@gmail.com`.
2. Move your subscriptions to it: re-subscribe with the new address, or change the email address in each newsletter's "manage subscription" page.
   - Alternative: in your main Gmail, create filters that **forward** specific senders to the new address.

## 3. Let the app read that Gmail (one-time, about 10 minutes)

Google requires every app that reads Gmail to have its own "client ID". You create one for yourself, for free:

1. Go to <https://console.cloud.google.com/> **while signed in as the new Gmail account**, and create a project (e.g. "Letterbox").
2. **APIs & Services → Library** → search for **Gmail API** → **Enable**.
3. **Google Auth Platform** (a.k.a. *OAuth consent screen*) → **Get started**:
   - App name: `Letterbox`, support email: your address, Audience: **External**.
   - Under **Audience → Test users**, add your newsletter Gmail address.
     Leave the app in **Testing**. For personal use it never needs to be "published" or verified.
   - Under **Data access → Add or remove scopes**, add `https://www.googleapis.com/auth/gmail.modify`
     (it lets the app read messages and change read/star/archive; it can't delete or send email).
4. **Clients → Create client** → type **Web application**:
   - **Authorized JavaScript origins**: add `https://aleminopuy.github.io` (and `http://localhost:8000` if you'll run it locally). No redirect URIs are needed.
   - Create it and copy the **Client ID** (it ends in `.apps.googleusercontent.com`).
5. Put the client ID in **one** of these places:
   - **Easiest for every device:** paste it into `src/config.js` (`clientId: '...'`) and commit. Client IDs aren't secret.
   - Or paste it into the app on each device under **Settings → Gmail**.
6. In the app, tap **Sign in** and pick the newsletter account. Google will warn that
   *"Google hasn't verified this app"*. That's expected for your own app: tap **Continue**.

Sign-in lasts about an hour. After that you can still read everything saved offline, and tapping refresh signs you back in with one tap.

## 4. Install it on your devices

| Device | How |
| --- | --- |
| **Android phone** | Open the app URL in Chrome → ⋮ menu → **Install app** (or *Add to Home screen*). |
| **Mac** | Chrome/Edge: click the install icon at the right of the address bar. Safari (Sonoma+): **File → Add to Dock**. |
| **Boox Note Air2** | Easiest is Chrome from the Play Store (enable Google Play under *Settings → Apps*), then **Install app** as on the phone. The built-in NeoBrowser also works. |

**Boox tips:** in the app, go to **Settings → Look → Theme → E-ink (Boox)**. That turns on page-turning; tap the right two-thirds of the page to go forward and the left third to go back. In the Boox *E-ink Center / App optimization* for Chrome, pick a refresh mode like **Balanced** or **HD**, and try turning off "animation" filters. Bump the text size with **A+** in the reader.

## Using it

- **Unread** is your "what's new" page. Open something, and **Next →** at the bottom goes to the next item.
- **Archive** (box icon) clears an item from Unread/Inbox. Archiving from the reader jumps straight to the next item.
- **Star** saves it for later under **Saved**.
- Tap a publication in the sidebar to see just that one. There you can **Favorite** (pins it to the top), **Rename**, or **Mute** (hides it from Unread without unsubscribing).
- **Unsubscribe** and **Open on web** links are at the end of each newsletter.
- On a keyboard: `j`/`k` next/previous, `o` open, `u` back, `s` save, `e` archive, `m` read/unread, `v` original view, `r` refresh.

### About RSS feeds

Many sites don't allow browser apps to read their feeds directly (a restriction called CORS). When that happens, Letterbox fetches the feed through a proxy. The default is the free public `api.allorigins.win`. To run your own free proxy instead, see [`tools/cors-proxy-worker.js`](tools/cors-proxy-worker.js).

Read/saved state for RSS items is stored **on each device** (only emails sync through Gmail).

## Tweaking

Everything is plain files. Edit, refresh, done:

| File | What it does |
| --- | --- |
| `src/config.js` | Client ID and feed-proxy defaults |
| `src/clean.js` | The clean view: what counts as boilerplate, how images/headings are handled |
| `styles.css` | Look & feel, themes (including the e-ink theme at the top) |
| `src/app.js` | Screens, buttons, keyboard shortcuts |
| `src/store.js` | Syncing, read/saved/archive logic, feeds |
| `src/gmail.js` / `src/feeds.js` | Gmail API and RSS/Atom parsing |
| `src/demo.js` | The sample newsletters |
| `sw.js` | Offline support |

The app always loads the newest files when you're online, so a pushed change shows up the next time you open it.

## Privacy

There is no server. Your emails go straight from Google to your device and are stored only in that browser's local storage. The only third party involved is the RSS proxy, which sees which feed URLs you fetch through it.
