import { getRuntimeConfig } from './config.js';
import { getSession, getSettings, markViewedByUrl } from './firebase-rest.js';

const MANAGED_KEY = 'noxManagedWindows';
const HIDDEN_KEY = 'noxHiddenSession';
const SIDEBAR_WINDOWS_KEY = 'noxSidebarWindows';
const transient = chrome.storage.session || chrome.storage.local;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

async function getManagedMap() { const saved = await transient.get(MANAGED_KEY); return saved[MANAGED_KEY] || {}; }
async function setManagedMap(map) { await transient.set({ [MANAGED_KEY]: map }); }
async function putManaged(state) { const map = await getManagedMap(); map[String(state.windowId)] = state; await setManagedMap(map); return state; }
async function removeManaged(windowId) { const map = await getManagedMap(); delete map[String(windowId)]; await setManagedMap(map); }
async function getManaged(windowId) { const map = await getManagedMap(); return map[String(windowId)] || null; }

async function getSidebarWindows() { const saved = await transient.get(SIDEBAR_WINDOWS_KEY); return new Set(saved[SIDEBAR_WINDOWS_KEY] || []); }
async function setSidebarWindow(windowId, visible) {
  const ids = await getSidebarWindows();
  if (visible) ids.add(windowId); else ids.delete(windowId);
  await transient.set({ [SIDEBAR_WINDOWS_KEY]: Array.from(ids) });
}
async function shouldAutoShow(windowId) {
  if (!windowId) return false;
  if (await getManaged(windowId)) return true;
  return (await getSidebarWindows()).has(windowId);
}

async function messageTab(tabId, type, payload = {}, retries = 1) {
  for (let i = 0; i < retries; i += 1) {
    try { return await chrome.tabs.sendMessage(tabId, { type, payload }); }
    catch (error) {
      if (i === retries - 1) throw error;
      await delay(250);
    }
  }
  return null;
}
async function showSidebar(tabId, windowId) {
  if (windowId) await setSidebarWindow(windowId, true);
  return messageTab(tabId, 'NOX_SHOW_SIDEBAR', {}, 12).catch(() => null);
}
async function hideSidebar(tabId, windowId) {
  if (windowId) await setSidebarWindow(windowId, false);
  return messageTab(tabId, 'NOX_HIDE_SIDEBAR', {}, 2).catch(() => null);
}
async function toggleSidebar(tab) {
  if (!tab || !tab.id || !/^https?:/i.test(tab.url || '')) {
    await chrome.runtime.openOptionsPage();
    return { visible: false, unsupported: true };
  }
  let response = null;
  try { response = await messageTab(tab.id, 'NOX_TOGGLE_SIDEBAR', {}, 2); }
  catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      response = await messageTab(tab.id, 'NOX_TOGGLE_SIDEBAR', {}, 4);
    } catch {
      await chrome.runtime.openOptionsPage();
      return { visible: false, unsupported: true };
    }
  }
  if (tab.windowId && response && typeof response.visible === 'boolean') await setSidebarWindow(tab.windowId, response.visible);
  return response || { visible: false };
}

chrome.runtime.onInstalled.addListener(() => {});
chrome.runtime.onStartup.addListener(async () => {
  if (!chrome.storage.session) {
    await chrome.storage.local.remove([MANAGED_KEY, HIDDEN_KEY, SIDEBAR_WINDOWS_KEY, 'noxUnlockedVaults']).catch(() => {});
  }
});
chrome.action.onClicked.addListener(tab => { toggleSidebar(tab).catch(() => {}); });

function safeItems(session) {
  return (session && session.tabs || []).filter(t => {
    try { return /^https?:$/.test(new URL(t.url).protocol); } catch { return false; }
  }).map((t, index) => ({
    id: t.id || uuid(), index, url: t.url, title: t.title || t.url,
    thumbnail: t.thumbnail || '', tags: t.tags || [], categoryIds: t.categoryIds || t.categories || []
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
  if (!firstTab || !firstTab.id) throw new Error('Chrome could not create the session window.');
  const slots = [{ tabId: firstTab.id, itemIndex: 0, lastUsed: Date.now() }];
  for (let i = 1; i < poolCount; i += 1) {
    const tab = await chrome.tabs.create({ windowId: created.id, url: items[i].url, active: false });
    slots.push({ tabId: tab.id, itemIndex: i, lastUsed: Date.now() - (poolCount - i) });
  }
  const state = { windowId: created.id, vaultId, sessionId: session.id || '', sessionName: session.name || 'Nox Session', maxActive, items, slots, currentIndex: 0, openedAt: Date.now() };
  await putManaged(state);
  await setSidebarWindow(created.id, true);
  markViewedByUrl(vaultId, items[0].url).catch(() => {});
  showSidebar(firstTab.id, created.id).catch(() => {});
  return state;
}

async function activateSessionIndex(windowId, index) {
  const state = await getManaged(windowId);
  if (!state) throw new Error('This Chrome window is not attached to a Nox session.');
  const targetIndex = Math.max(0, Math.min(state.items.length - 1, Number(index)));
  const existing = state.slots.find(s => s.itemIndex === targetIndex);
  if (existing) {
    existing.lastUsed = Date.now(); state.currentIndex = targetIndex;
    await chrome.tabs.update(existing.tabId, { active: true }); await putManaged(state);
    markViewedByUrl(state.vaultId, state.items[targetIndex].url).catch(() => {});
    showSidebar(existing.tabId, windowId).catch(() => {});
    return state;
  }
  const activeTabs = await chrome.tabs.query({ windowId, active: true });
  const activeId = activeTabs[0] && activeTabs[0].id;
  let slot = state.slots.filter(s => s.tabId !== activeId).sort((a, b) => a.lastUsed - b.lastUsed)[0];
  if (!slot) slot = state.slots.slice().sort((a, b) => a.lastUsed - b.lastUsed)[0];
  if (!slot) throw new Error('No reusable browser slot is available.');
  slot.itemIndex = targetIndex; slot.lastUsed = Date.now(); state.currentIndex = targetIndex;
  await chrome.tabs.update(slot.tabId, { url: state.items[targetIndex].url, active: true });
  await putManaged(state); markViewedByUrl(state.vaultId, state.items[targetIndex].url).catch(() => {});
  showSidebar(slot.tabId, windowId).catch(() => {});
  return state;
}

async function openSingleUrl(payload = {}) {
  const url = payload.url; if (!url) throw new Error('Missing URL.');
  const tab = await chrome.tabs.create({ url, active: true });
  if (payload.vaultId) markViewedByUrl(payload.vaultId, url).catch(() => {});
  if (tab.windowId) await setSidebarWindow(tab.windowId, true);
  showSidebar(tab.id, tab.windowId).catch(() => {});
  return { tabId: tab.id, windowId: tab.windowId };
}

async function navigateActive(payload = {}) {
  const url = payload.url; if (!url) throw new Error('Missing URL.');
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  const tab = tabs.find(t => /^https?:/i.test(t.url || '')) || tabs[0];
  if (!tab || !tab.id) return openSingleUrl(payload);
  await chrome.tabs.update(tab.id, { url, active: true });
  if (payload.vaultId) markViewedByUrl(payload.vaultId, url).catch(() => {});
  if (tab.windowId) await setSidebarWindow(tab.windowId, true);
  showSidebar(tab.id, tab.windowId).catch(() => {});
  return { tabId: tab.id, windowId: tab.windowId };
}

async function panic(windowId) {
  let targetWindowId = windowId;
  if (!targetWindowId) targetWindowId = (await chrome.windows.getLastFocused()).id;
  const state = await getManaged(targetWindowId);
  const config = await getRuntimeConfig();
  const decoyUrl = config.decoyUrl || config.webAppUrl || 'chrome://newtab/';
  await setSidebarWindow(targetWindowId, false).catch(() => {});
  if (state) {
    await transient.set({ [HIDDEN_KEY]: state });
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
  const saved = await transient.get(HIDDEN_KEY); const state = saved[HIDDEN_KEY];
  if (!state) throw new Error('There is no hidden Nox session to restore.');
  await transient.remove(HIDDEN_KEY);
  return openSessionPool({ vaultId: state.vaultId, session: { id: state.sessionId, name: state.sessionName, tabs: state.items }, maxActiveTabs: state.maxActive });
}

async function windowTabs(windowId) {
  const tabs = await chrome.tabs.query({ windowId });
  return tabs.filter(t => /^https?:/i.test(t.url || '')).map(t => ({ id: t.id, url: t.url, title: t.title || t.url, active: t.active, pinned: t.pinned, discarded: t.discarded }));
}

async function perform(action, payload = {}, sender = null) {
  switch (action) {
    case 'PING': return { ok: true, version: chrome.runtime.getManifest().version, mode: 'legacy-in-page-sidebar', minimumChrome: chrome.runtime.getManifest().minimum_chrome_version || '' };
    case 'OPEN_OPTIONS': await chrome.runtime.openOptionsPage(); return { ok: true };
    case 'OPEN_SESSION_FROM_WEB': {
      const session = await getSession(payload.vaultId, payload.sessionId); if (!session) throw new Error('Session not found in Firestore.');
      return { ok: true, state: await openSessionPool({ vaultId: payload.vaultId, session, maxActiveTabs: payload.maxActiveTabs }) };
    }
    case 'OPEN_SESSION_OBJECT': return { ok: true, state: await openSessionPool(payload) };
    case 'OPEN_URL': return { ok: true, ...(await openSingleUrl(payload)) };
    case 'NAVIGATE_ACTIVE': return { ok: true, ...(await navigateActive(payload)) };
    case 'ACTIVATE_SESSION_INDEX': return { ok: true, state: await activateSessionIndex(payload.windowId, payload.index) };
    case 'GET_MANAGED_STATE': return { ok: true, state: await getManaged(payload.windowId) };
    case 'GET_WINDOW_TABS': return { ok: true, tabs: await windowTabs(payload.windowId) };
    case 'PANIC': return { ok: true, ...(await panic(payload.windowId || (sender && sender.tab && sender.tab.windowId))) };
    case 'RESTORE_PANIC': return { ok: true, state: await restoreHidden() };
    case 'NOX_SHOULD_AUTO_SHOW': return { ok: true, show: await shouldAutoShow(sender && sender.tab && sender.tab.windowId) };
    case 'SET_SIDEBAR_VISIBLE': {
      const wid = payload.windowId || (sender && sender.tab && sender.tab.windowId);
      if (wid) await setSidebarWindow(wid, Boolean(payload.visible));
      return { ok: true, visible: Boolean(payload.visible) };
    }
    default: throw new Error(`Unknown Nox extension action: ${action}`);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const action = message && message.type === 'WEB_BRIDGE' ? message.action : message && message.type;
  if (!action) return;
  perform(action, message && message.payload || {}, sender)
    .then(result => sendResponse(result && result.ok === false ? result : { ok: true, ...result }))
    .catch(error => sendResponse({ ok: false, error: error && error.message || String(error) }));
  return true;
});

chrome.tabs.onActivated.addListener(async info => {
  const state = await getManaged(info.windowId);
  if (state) {
    const slot = state.slots.find(s => s.tabId === info.tabId);
    if (slot) { slot.lastUsed = Date.now(); state.currentIndex = slot.itemIndex; await putManaged(state); const item = state.items[slot.itemIndex]; if (item) markViewedByUrl(state.vaultId, item.url).catch(() => {}); }
  }
  if (await shouldAutoShow(info.windowId)) showSidebar(info.tabId, info.windowId).catch(() => {});
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab && tab.windowId) shouldAutoShow(tab.windowId).then(show => { if (show) showSidebar(tabId, tab.windowId).catch(() => {}); });
});
chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  const state = await getManaged(removeInfo.windowId); if (!state) return;
  state.slots = state.slots.filter(s => s.tabId !== tabId);
  if (!state.slots.length) await removeManaged(removeInfo.windowId); else await putManaged(state);
});
chrome.windows.onRemoved.addListener(async windowId => { await removeManaged(windowId); await setSidebarWindow(windowId, false).catch(() => {}); });
chrome.commands.onCommand.addListener(async command => {
  if (command === 'panic-hide') return panic().catch(() => {});
  if (command === 'toggle-sidebar') {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return toggleSidebar(tabs[0]).catch(() => {});
  }
});
