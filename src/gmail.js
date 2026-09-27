// Gmail access straight from the browser — no server involved.
// Sign-in uses Google Identity Services' token flow: you get a 1-hour access
// token, stored locally so reopening the app within the hour doesn't prompt.

import { settings, saveSettings } from './settings.js';

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const SCOPE = 'https://www.googleapis.com/auth/gmail.modify';
const TOKEN_KEY = 'lb.token';

export class AuthError extends Error {}

let token = readToken();
let tokenClient = null;
let tokenClientId = null;
let pending = null;
let gisPromise = null;

function readToken() {
  try { return JSON.parse(localStorage.getItem(TOKEN_KEY)); } catch { return null; }
}
function writeToken(t) {
  token = t;
  try { t ? localStorage.setItem(TOKEN_KEY, JSON.stringify(t)) : localStorage.removeItem(TOKEN_KEY); } catch {}
}

export function isConfigured() {
  return Boolean(settings.clientId);
}

export function isSignedIn() {
  return Boolean(token && token.expires > Date.now() + 60_000);
}

/** Load Google's sign-in script early so a later click can open the popup synchronously. */
export function preloadSignIn() {
  if (!isConfigured() || gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { gisPromise = null; reject(new Error('Could not load Google sign-in (offline?)')); };
    document.head.appendChild(s);
  });
  gisPromise.catch(() => {});
  return gisPromise;
}

/** Must be called from a click/tap handler, or the browser blocks the popup. */
export function signIn() {
  return new Promise((resolve, reject) => {
    if (!isConfigured()) return reject(new Error('Add your Google client ID in Settings first.'));
    if (!window.google?.accounts?.oauth2) {
      preloadSignIn();
      return reject(new Error('Google sign-in is still loading — tap again in a moment.'));
    }
    if (!tokenClient || tokenClientId !== settings.clientId) {
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: settings.clientId,
        scope: SCOPE,
        callback: (resp) => {
          const p = pending; pending = null;
          if (resp.error) return p?.reject(new Error(resp.error_description || resp.error));
          writeToken({ access_token: resp.access_token, expires: Date.now() + resp.expires_in * 1000 });
          p?.resolve();
        },
        error_callback: (err) => {
          const p = pending; pending = null;
          p?.reject(new Error(err.type === 'popup_closed' ? 'Sign-in was cancelled.' : err.message || 'Sign-in failed.'));
        },
      });
      tokenClientId = settings.clientId;
    }
    pending = { resolve, reject };
    tokenClient.requestAccessToken({ prompt: settings.email ? '' : 'consent', login_hint: settings.email || undefined });
  }).then(async () => {
    if (!settings.email) {
      const profile = await api('/profile');
      saveSettings({ email: profile.emailAddress });
    }
  });
}

export function signOut() {
  if (token && window.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token.access_token, () => {});
  writeToken(null);
  saveSettings({ email: '' });
}

async function api(path, { method = 'GET', body } = {}) {
  if (!isSignedIn()) throw new AuthError('Sign in to Gmail to sync.');
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(API + path, {
      method,
      headers: {
        Authorization: `Bearer ${token.access_token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.ok) return res.json();
    if (res.status === 401) { writeToken(null); throw new AuthError('Gmail sign-in expired.'); }
    if ((res.status === 429 || res.status >= 500) && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    const err = new Error(`Gmail error ${res.status}`);
    err.status = res.status;
    throw err;
  }
}

export async function listIds(q, max) {
  const ids = [];
  let pageToken = '';
  while (ids.length < max) {
    const params = new URLSearchParams({ q, maxResults: String(Math.min(500, max - ids.length)) });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await api(`/messages?${params}`);
    (data.messages || []).forEach((m) => ids.push(m.id));
    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }
  return ids;
}

export function modify(id, add = [], remove = []) {
  return api(`/messages/${id}/modify`, { method: 'POST', body: { addLabelIds: add, removeLabelIds: remove } });
}

/** Fetch one email and return { meta, body } ready for the database. */
export async function getMessage(id) {
  const m = await api(`/messages/${id}?format=full`);
  const headers = {};
  for (const h of m.payload?.headers || []) headers[h.name.toLowerCase()] = h.value;

  const parts = { html: null, text: null };
  collectParts(m.payload, parts);
  const [html, text] = await Promise.all([readPart(id, parts.html), readPart(id, parts.text)]);

  const from = parseFrom(headers.from || '');
  const labels = new Set(m.labelIds || []);
  return {
    meta: {
      id,
      origin: 'gmail',
      date: Number(m.internalDate) || Date.parse(headers.date) || Date.now(),
      fromName: from.name,
      fromEmail: from.email,
      source: from.email || from.name || 'unknown',
      subject: headers.subject || '(no subject)',
      snippet: decodeEntities(m.snippet || ''),
      unsubscribe: pickUnsubscribe(headers['list-unsubscribe']),
      link: '',
      inbox: labels.has('INBOX'),
      unread: labels.has('UNREAD'),
      starred: labels.has('STARRED'),
    },
    body: { id, html: html || '', text: text || '' },
  };
}

function collectParts(part, out) {
  if (!part) return;
  const type = (part.mimeType || '').toLowerCase();
  const isAttachment = Boolean(part.filename);
  if (!isAttachment && type === 'text/html' && !out.html) out.html = part;
  else if (!isAttachment && type === 'text/plain' && !out.text) out.text = part;
  (part.parts || []).forEach((p) => collectParts(p, out));
}

async function readPart(msgId, part) {
  if (!part) return '';
  let data = part.body?.data;
  if (!data && part.body?.attachmentId) {
    data = (await api(`/messages/${msgId}/attachments/${part.body.attachmentId}`)).data;
  }
  if (!data) return '';
  const ctype = (part.headers || []).find((h) => h.name.toLowerCase() === 'content-type')?.value || '';
  const charset = /charset="?([^";\s]+)/i.exec(ctype)?.[1] || 'utf-8';
  return decodeBase64Url(data, charset);
}

function decodeBase64Url(data, charset) {
  const bin = atob(data.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  try { return new TextDecoder(charset).decode(bytes); } catch { return new TextDecoder().decode(bytes); }
}

export function parseFrom(value) {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(value);
  if (m) return { name: m[1].trim() || m[2].trim(), email: m[2].trim().toLowerCase() };
  const email = value.trim().toLowerCase();
  return { name: email, email };
}

function pickUnsubscribe(value) {
  if (!value) return '';
  const links = [...value.matchAll(/<([^>]+)>/g)].map((m) => m[1].trim());
  return links.find((l) => /^https?:/i.test(l)) || links.find((l) => /^mailto:/i.test(l)) || '';
}

function decodeEntities(s) {
  return new DOMParser().parseFromString(s, 'text/html').documentElement.textContent;
}
