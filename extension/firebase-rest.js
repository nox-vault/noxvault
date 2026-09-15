import { getRuntimeConfig, configReady } from './config.js';

const AUTH_KEY = 'noxAuth';
const UNLOCK_KEY = 'noxUnlockedVaults';

function b64ToBytes(value = '') {
  const raw = atob(value);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

function bytesToHex(bytes) {
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function normalizeUrl(raw = '') {
  try {
    const u = new URL(String(raw).trim());
    u.hash = '';
    ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','ref','referrer','fbclid','gclid'].forEach(k => u.searchParams.delete(k));
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/$/, '');
    return u.toString();
  } catch {
    return String(raw || '').trim();
  }
}

export async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return bytesToHex(new Uint8Array(digest));
}

export function sourceFromUrl(raw = '') {
  try { return new URL(raw).hostname.replace(/^www\./, ''); }
  catch { return 'link'; }
}

function toFirestoreValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(toFirestoreValue) } };
  switch (typeof value) {
    case 'string': return { stringValue: value };
    case 'boolean': return { booleanValue: value };
    case 'number':
      return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    case 'object': {
      const fields = {};
      for (const [k, v] of Object.entries(value)) fields[k] = toFirestoreValue(v);
      return { mapValue: { fields } };
    }
    default: return { stringValue: String(value) };
  }
}

function fromFirestoreValue(value) {
  if (!value) return null;
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return Number(value.doubleValue);
  if ('timestampValue' in value) return value.timestampValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(fromFirestoreValue);
  if ('mapValue' in value) {
    const out = {};
    for (const [k, v] of Object.entries(value.mapValue.fields || {})) out[k] = fromFirestoreValue(v);
    return out;
  }
  if ('bytesValue' in value) return value.bytesValue;
  if ('referenceValue' in value) return value.referenceValue;
  if ('geoPointValue' in value) return value.geoPointValue;
  return null;
}

function encodeDocument(data) {
  const fields = {};
  for (const [k, v] of Object.entries(data || {})) fields[k] = toFirestoreValue(v);
  return { fields };
}

function decodeDocument(doc) {
  if (!doc) return null;
  const out = {};
  for (const [k, v] of Object.entries(doc.fields || {})) out[k] = fromFirestoreValue(v);
  if (!out.id && doc.name) out.id = decodeURIComponent(doc.name.split('/').pop());
  return out;
}

async function getAuthRecord() {
  const saved = await chrome.storage.local.get(AUTH_KEY);
  return saved[AUTH_KEY] || null;
}

async function saveAuthRecord(record) {
  await chrome.storage.local.set({ [AUTH_KEY]: record });
  return record;
}

export async function logout() {
  await chrome.storage.local.remove(AUTH_KEY);
  await chrome.storage.session.remove(UNLOCK_KEY);
}

export async function login(email, password) {
  const config = await getRuntimeConfig();
  if (!configReady(config)) throw new Error('Extension Firebase setup is incomplete. Open Nox Extension Settings and add the Firebase API key.');
  const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(config.apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: true })
  });
  const payload = await response.json();
  if (!response.ok) {
    const code = payload?.error?.message || `HTTP ${response.status}`;
    if (/INVALID_LOGIN_CREDENTIALS|INVALID_PASSWORD|EMAIL_NOT_FOUND/i.test(code)) throw new Error('Incorrect email or password.');
    throw new Error(`Firebase login failed: ${code}`);
  }
  if (config.ownerUid && payload.localId !== config.ownerUid) throw new Error('This Firebase account is not the configured Nox Vault owner.');
  return saveAuthRecord({
    uid: payload.localId,
    email: payload.email || email,
    idToken: payload.idToken,
    refreshToken: payload.refreshToken,
    expiresAt: Date.now() + Math.max(60, Number(payload.expiresIn || 3600) - 120) * 1000
  });
}

async function refreshAuth(record, config) {
  const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(config.apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: record.refreshToken })
  });
  const payload = await response.json();
  if (!response.ok) throw new Error('Firebase login expired. Sign in to the Nox extension again.');
  const next = {
    ...record,
    uid: payload.user_id || record.uid,
    idToken: payload.id_token,
    refreshToken: payload.refresh_token || record.refreshToken,
    expiresAt: Date.now() + Math.max(60, Number(payload.expires_in || 3600) - 120) * 1000
  };
  return saveAuthRecord(next);
}

export async function getAuth() {
  const config = await getRuntimeConfig();
  if (!configReady(config)) return null;
  let record = await getAuthRecord();
  if (!record) return null;
  if (record.expiresAt && record.expiresAt > Date.now()) return record;
  try { record = await refreshAuth(record, config); }
  catch { await logout(); return null; }
  return record;
}

async function requireAuth() {
  const config = await getRuntimeConfig();
  if (!configReady(config)) throw new Error('Extension Firebase setup is incomplete.');
  const auth = await getAuth();
  if (!auth) throw new Error('Sign in to the Nox extension first.');
  if (config.ownerUid && auth.uid !== config.ownerUid) throw new Error('Wrong Firebase owner account.');
  return { config, auth };
}

function firestoreBase(config) {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(config.projectId)}/databases/(default)/documents`;
}

function joinPath(segments) {
  return segments.map(x => encodeURIComponent(String(x))).join('/');
}

async function firestoreFetch(segments, options = {}) {
  const { config, auth } = await requireAuth();
  const query = options.query ? `?${new URLSearchParams(options.query)}` : '';
  const response = await fetch(`${firestoreBase(config)}/${joinPath(segments)}${query}`, {
    ...options,
    headers: {
      authorization: `Bearer ${auth.idToken}`,
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
  if (response.status === 404) return null;
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) throw new Error(payload?.error?.message || `Firestore request failed (${response.status}).`);
  return payload;
}

async function getDoc(segments) {
  const raw = await firestoreFetch(segments, { method: 'GET' });
  return decodeDocument(raw);
}

async function setDoc(segments, data) {
  const raw = await firestoreFetch(segments, { method: 'PATCH', body: JSON.stringify(encodeDocument(data)) });
  return decodeDocument(raw);
}

async function listDocs(segments) {
  const rows = [];
  let token = '';
  do {
    const raw = await firestoreFetch(segments, { method: 'GET', query: { pageSize: '200', ...(token ? { pageToken: token } : {}) } });
    for (const doc of raw?.documents || []) rows.push(decodeDocument(doc));
    token = raw?.nextPageToken || '';
  } while (token && rows.length < 2000);
  return rows;
}

function root(uid) { return ['users', uid]; }
function vaultPath(uid, vaultId, collectionName) { return [...root(uid), 'vaults', vaultId, collectionName]; }

export async function listVaults() {
  const auth = await getAuth();
  if (!auth) throw new Error('Sign in first.');
  return listDocs([...root(auth.uid), 'vaults']);
}

export async function getVault(vaultId) {
  const auth = await getAuth();
  if (!auth) throw new Error('Sign in first.');
  return getDoc([...root(auth.uid), 'vaults', vaultId]);
}

export async function verifyVaultPassword(vaultId, password) {
  const vault = await getVault(vaultId);
  if (!vault?.lockHash || !vault?.lockSalt) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2', salt: b64ToBytes(vault.lockSalt), iterations: Number(vault.lockIterations || 210000), hash: 'SHA-256'
  }, key, 256);
  let raw = '';
  const bytes = new Uint8Array(bits);
  for (let i = 0; i < bytes.length; i += 1) raw += String.fromCharCode(bytes[i]);
  return btoa(raw) === vault.lockHash;
}

export async function setVaultUnlocked(vaultId, unlocked = true) {
  const saved = await chrome.storage.session.get(UNLOCK_KEY);
  const ids = new Set(saved[UNLOCK_KEY] || []);
  if (unlocked) ids.add(vaultId); else ids.delete(vaultId);
  await chrome.storage.session.set({ [UNLOCK_KEY]: [...ids] });
}

export async function isVaultUnlocked(vaultId) {
  const saved = await chrome.storage.session.get(UNLOCK_KEY);
  return (saved[UNLOCK_KEY] || []).includes(vaultId);
}

export async function listCategories(vaultId) {
  const auth = await getAuth();
  return listDocs(vaultPath(auth.uid, vaultId, 'categories'));
}

export async function listItems(vaultId) {
  const auth = await getAuth();
  const rows = await listDocs(vaultPath(auth.uid, vaultId, 'items'));
  return rows.filter(x => !x.deletedAt);
}

export async function getSettings() {
  const auth = await getAuth();
  if (!auth) throw new Error('Sign in first.');
  return (await getDoc([...root(auth.uid), 'settings', 'app'])) || { maxActiveTabs: 3 };
}

export async function getSession(vaultId, sessionId) {
  const auth = await getAuth();
  return getDoc([...vaultPath(auth.uid, vaultId, 'sessions'), sessionId]);
}

export async function listSessions(vaultId) {
  const auth = await getAuth();
  return listDocs(vaultPath(auth.uid, vaultId, 'sessions'));
}

export async function saveSession(vaultId, data) {
  const auth = await getAuth();
  const id = data.id || crypto.randomUUID();
  const existing = await getDoc([...vaultPath(auth.uid, vaultId, 'sessions'), id]);
  const row = {
    id,
    name: data.name || existing?.name || 'Untitled Session',
    tabs: data.tabs || existing?.tabs || [],
    categoryIds: data.categoryIds || existing?.categoryIds || [],
    createdAt: existing?.createdAt || data.createdAt || new Date(),
    updatedAt: new Date(),
    lastOpenedAt: data.lastOpenedAt || existing?.lastOpenedAt || null
  };
  return setDoc([...vaultPath(auth.uid, vaultId, 'sessions'), id], row);
}

export async function saveItem(vaultId, data, { skipIfExists = true } = {}) {
  const auth = await getAuth();
  const normalizedUrl = normalizeUrl(data.url || '');
  if (!/^https?:/i.test(normalizedUrl)) throw new Error('Only http/https pages can be saved by the extension.');
  const id = data.id || await sha256(normalizedUrl);
  const path = [...vaultPath(auth.uid, vaultId, 'items'), id];
  const existing = await getDoc(path);
  if (existing && skipIfExists) return { status: 'skipped', item: existing };
  const row = {
    ...(existing || {}),
    id,
    title: data.title || existing?.title || normalizedUrl,
    url: data.url,
    normalizedUrl,
    source: data.source || sourceFromUrl(data.url),
    thumbnail: data.thumbnail || existing?.thumbnail || '',
    embedUrl: data.embedUrl || existing?.embedUrl || '',
    mediaUrl: data.mediaUrl || existing?.mediaUrl || '',
    categories: data.categories || existing?.categories || [],
    tags: data.tags || existing?.tags || [],
    favorite: Boolean(data.favorite ?? existing?.favorite ?? false),
    rating: Number(data.rating ?? existing?.rating ?? 0),
    notes: data.notes ?? existing?.notes ?? '',
    duration: data.duration || existing?.duration || '',
    related: Array.isArray(data.related) ? data.related.slice(0, 24) : (existing?.related || []),
    createdAt: existing?.createdAt || new Date(),
    lastViewedAt: existing?.lastViewedAt || null,
    viewCount: Number(existing?.viewCount || 0),
    deletedAt: null
  };
  return { status: existing ? 'updated' : 'saved', item: await setDoc(path, row) };
}

export async function markViewedByUrl(vaultId, url) {
  try {
    const auth = await getAuth();
    if (!auth || !vaultId || !url) return false;
    const id = await sha256(normalizeUrl(url));
    const path = [...vaultPath(auth.uid, vaultId, 'items'), id];
    const item = await getDoc(path);
    if (!item) return false;
    item.lastViewedAt = new Date();
    item.viewCount = Number(item.viewCount || 0) + 1;
    await setDoc(path, item);
    return true;
  } catch {
    return false;
  }
}
