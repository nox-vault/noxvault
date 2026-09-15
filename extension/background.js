import { getRuntimeConfig } from './config.js';
import { getSession, getSettings, markViewedByUrl } from './firebase-rest.js';

const MANAGED_KEY = 'noxManagedWindows';
const HIDDEN_KEY = 'noxHiddenSession';

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

async function getManagedMap() {
  const saved = await chrome.storage.session.get(MANAGED_KEY);
  return saved[MANAGED_KEY] || {};
}
async function setManagedMap(map) { await chrome.storage.session.set({ [MANAGED_KEY]: map }); }
async function putManaged(state) {
  const map = await getManagedMap();
  map[String(state.windowId)] = state;
  await setManagedMap(map);
  return state;
}
async function removeManaged(windowId) {
  const map = await getManagedMap();
  delete map[String(windowId)];
  await setManagedMap(map);
}
async function getManaged(windowId) {
  const map = await getManagedMap();
  return map[String(windowId)] || null;
}

function safeItems(session) {
  return (session?.tabs || []).filter(t => {
    try { return /^https?:$/.test(new URL(t.url).protocol); } catch { return false; }
  }).map((t, index) => ({
    id: t.id || crypto.randomUUID(),
    index,
    url: t.url,
    title: t.title || t.url,
    thumbnail: t.thumbnail || '',
    tags: t.tags || [],
    categoryIds: t.categoryIds || t.categories || []
  }));
}

async function openSessionPool({ vaultId, session, maxActiveTabs }) {
  const items = safeItems(session);
  if (!items.length) throw new Error('This session has no http/https tabs to open.');
  const settings = await getSettings().catch(() => ({}));
  const maxActive = Math.max(1, Math.min(5, Number(maxActiveTabs || settings.maxActiveTabs || 3)));
  const poolCount = Math.min(maxActive, items.length);
  const created = await chrome.windows.create({ url: items[0].url, focused: true });
  const createdTabs = await chrome.tabs.query({ windowId: created.id });
  const firstTab = createdTabs[0];
  if (!firstTab?.id) throw new Error('Chrome could not create the session window.');
  const slots = [{ tabId: firstTab.id, itemIndex: 0, lastUsed: Date.now() }];
  for (let i = 1; i < poolCount; i += 1) {
    const tab = await chrome.tabs.create({ windowId: created.id, url: items[i].url, active: false });
    slots.push({ tabId: tab.id, itemIndex: i, lastUsed: Date.now() - (poolCount - i) });
  }
  const state = {
    windowId: created.id,
    vaultId,
    sessionId: session.id || '',
    sessionName: session.name || 'Nox Session',
    maxActive,
    items,
    slots,
    currentIndex: 0,
    openedAt: Date.now()
  };
  await putManaged(state);
  markViewedByUrl(vaultId, items[0].url).catch(() => {});
  chrome.sidePanel.open({ windowId: created.id }).catch(() => {});
  return state;
}

async function activateSessionIndex(windowId, index) {
  const state = await getManaged(windowId);
  if (!state) throw new Error('This Chrome window is not attached to a Nox session.');
  const targetIndex = Math.max(0, Math.min(state.items.length - 1, Number(index)));
  const existing = state.slots.find(s => s.itemIndex === targetIndex);
  if (existing) {
    existing.lastUsed = Date.now();
    state.currentIndex = targetIndex;
    await chrome.tabs.update(existing.tabId, { active: true });
    await putManaged(state);
    markViewedByUrl(state.vaultId, state.items[targetIndex].url).catch(() => {});
    return state;
  }

  const activeTabs = await chrome.tabs.query({ windowId, active: true });
  const activeId = activeTabs[0]?.id;
  let slot = state.slots.filter(s => s.tabId !== activeId).sort((a, b) => a.lastUsed - b.lastUsed)[0];
  if (!slot) slot = state.slots.sort((a, b) => a.lastUsed - b.lastUsed)[0];
  if (!slot) throw new Error('No reusable browser slot is available.');
  slot.itemIndex = targetIndex;
  slot.lastUsed = Date.now();
  state.currentIndex = targetIndex;
  await chrome.tabs.update(slot.tabId, { url: state.items[targetIndex].url, active: true });
  await putManaged(state);
  markViewedByUrl(state.vaultId, state.items[targetIndex].url).catch(() => {});
  return state;
}

async function openSingleUrl(payload = {}) {
  const url = payload.url;
  if (!url) throw new Error('Missing URL.');
  const tab = await chrome.tabs.create({ url, active: true });
  if (payload.vaultId) markViewedByUrl(payload.vaultId, url).catch(() => {});
  if (tab.windowId) chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  return { tabId: tab.id, windowId: tab.windowId };
}

async function navigateActive(payload = {}) {
  const url = payload.url;
  if (!url) throw new Error('Missing URL.');
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs.find(t => /^https?:/i.test(t.url || '')) || tabs[0];
  if (!tab?.id) return openSingleUrl(payload);
  await chrome.tabs.update(tab.id, { url, active: true });
  if (payload.vaultId) markViewedByUrl(payload.vaultId, url).catch(() => {});
  return { tabId: tab.id, windowId: tab.windowId };
}

async function panic(windowId) {
  let targetWindowId = windowId;
  if (!targetWindowId) targetWindowId = (await chrome.windows.getLastFocused()).id;
  const state = await getManaged(targetWindowId);
  const config = await getRuntimeConfig();
  const decoyUrl = config.decoyUrl || config.webAppUrl || 'chrome://newtab/';
  if (state) {
    await chrome.storage.session.set({ [HIDDEN_KEY]: state });
    const decoy = await chrome.tabs.create({ windowId: targetWindowId, url: decoyUrl, active: true });
    const ids = state.slots.map(s => s.tabId).filter(id => id && id !== decoy.id);
    if (ids.length) await chrome.tabs.remove(ids).catch(() => {});
    await removeManaged(targetWindowId);
    return { hidden: true, decoyTabId: decoy.id };
  }
  const tab = await chrome.tabs.create({ windowId: targetWindowId, url: decoyUrl, active: true });
  return { hidden: false, decoyTabId: tab.id };
}

async function restoreHidden() {
  const saved = await chrome.storage.session.get(HIDDEN_KEY);
  const state = saved[HIDDEN_KEY];
  if (!state) throw new Error('There is no hidden Nox session to restore.');
  await chrome.storage.session.remove(HIDDEN_KEY);
  const session = { id: state.sessionId, name: state.sessionName, tabs: state.items };
  return openSessionPool({ vaultId: state.vaultId, session, maxActiveTabs: state.maxActive });
}

async function windowTabs(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  return tabs.filter(t => /^https?:/i.test(t.url || '')).map(t => ({ id: t.id, url: t.url, title: t.title || t.url, active: t.active, pinned: t.pinned, discarded: t.discarded }));
}

async function perform(action, payload = {}, sender = null) {
  switch (action) {
    case 'PING': return { ok: true, version: chrome.runtime.getManifest().version };
    case 'OPEN_OPTIONS': await chrome.runtime.openOptionsPage(); return { ok: true };
    case 'OPEN_SESSION_FROM_WEB': {
      const session = await getSession(payload.vaultId, payload.sessionId);
      if (!session) throw new Error('Session not found in Firestore.');
      return { ok: true, state: await openSessionPool({ vaultId: payload.vaultId, session, maxActiveTabs: payload.maxActiveTabs }) };
    }
    case 'OPEN_SESSION_OBJECT': return { ok: true, state: await openSessionPool(payload) };
    case 'OPEN_URL': return { ok: true, ...(await openSingleUrl(payload)) };
    case 'NAVIGATE_ACTIVE': return { ok: true, ...(await navigateActive(payload)) };
    case 'ACTIVATE_SESSION_INDEX': return { ok: true, state: await activateSessionIndex(payload.windowId, payload.index) };
    case 'GET_MANAGED_STATE': return { ok: true, state: await getManaged(payload.windowId) };
    case 'GET_WINDOW_TABS': return { ok: true, tabs: await windowTabs(payload.windowId) };
    case 'PANIC': return { ok: true, ...(await panic(payload.windowId || sender?.tab?.windowId)) };
    case 'RESTORE_PANIC': return { ok: true, state: await restoreHidden() };
    default: throw new Error(`Unknown Nox extension action: ${action}`);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const action = message?.type === 'WEB_BRIDGE' ? message.action : message?.type;
  if (!action) return;
  perform(action, message?.payload || {}, sender)
    .then(result => sendResponse(result?.ok === false ? result : { ok: true, ...result }))
    .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
  return true;
});

chrome.tabs.onActivated.addListener(async info => {
  const state = await getManaged(info.windowId);
  if (!state) return;
  const slot = state.slots.find(s => s.tabId === info.tabId);
  if (!slot) return;
  slot.lastUsed = Date.now();
  state.currentIndex = slot.itemIndex;
  await putManaged(state);
  const item = state.items[slot.itemIndex];
  if (item) markViewedByUrl(state.vaultId, item.url).catch(() => {});
});

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  const state = await getManaged(removeInfo.windowId);
  if (!state) return;
  state.slots = state.slots.filter(s => s.tabId !== tabId);
  if (!state.slots.length) await removeManaged(removeInfo.windowId); else await putManaged(state);
});

chrome.windows.onRemoved.addListener(windowId => removeManaged(windowId));

chrome.commands.onCommand.addListener(command => {
  if (command === 'panic-hide') panic().catch(() => {});
});
