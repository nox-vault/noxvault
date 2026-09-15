import { getRuntimeConfig, configReady } from './config.js';
import {
  getAuth, login, logout, listVaults, verifyVaultPassword, setVaultUnlocked, isVaultUnlocked,
  listCategories, listSessions, getSession, getSettings, saveSession, saveItem, sourceFromUrl
} from './firebase-rest.js';

const $ = s => document.querySelector(s);
const vaultHasPassword = v => Boolean(v && (v.lockHash || v.hasPassword));

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16); crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const h = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
const state = {
  auth: null, vaults: [], vaultId: '', vault: null, categories: [], sessions: [], settings: {}, scan: null, windowId: null, managed: null
};

function show(id) {
  for (const el of ['setup-view','login-view','vault-view','main-view'].map(x => document.getElementById(x))) el.classList.add('hidden');
  document.getElementById(id).classList.remove('hidden');
}
function setMessage(selector, text, good = false) {
  const el = $(selector); if (!el) return; el.textContent = text || ''; el.classList.toggle('good', good);
}
function esc(value='') { return String(value).replace(/[&<>"']/g,c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function parseTags(value='') { return [...new Set(String(value).split(/[,\n]/).map(x=>x.trim()).filter(Boolean))].slice(0,40); }
function activeCategorySuggestion(scan, categories) {
  const hay = `${scan?.title||''} ${(scan?.tags||[]).join(' ')}`.toLowerCase();
  return categories.find(c => c.name && hay.includes(String(c.name).toLowerCase()))?.id || '';
}
async function getCurrentWindowId() {
  const win = await chrome.windows.getCurrent();
  state.windowId = win.id;
  return win.id;
}
async function currentTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}
async function scanCurrentPage() {
  const tab = await currentTab();
  if (!tab?.id || !/^https?:/i.test(tab.url || '')) {
    state.scan = { url: tab?.url || '', title: tab?.title || 'Unsupported page', source: 'chrome', tags: [], related: [] };
    renderScan(); return state.scan;
  }
  try {
    const response = await chrome.tabs.sendMessage(tab.id, { type: 'NOX_SCAN_PAGE' });
    state.scan = response?.ok ? response.data : { url: tab.url, title: tab.title || tab.url, source: sourceFromUrl(tab.url), tags: [], related: [] };
  } catch {
    state.scan = { url: tab.url, title: tab.title || tab.url, source: sourceFromUrl(tab.url), tags: [], related: [] };
  }
  renderScan();
  return state.scan;
}
function renderScan() {
  const s = state.scan || {};
  $('#page-title').textContent = s.title || 'Current page';
  $('#page-source').textContent = s.source || sourceFromUrl(s.url || '');
  $('#page-url').textContent = s.url || '';
  $('#save-title').value = s.title || '';
  $('#tags').value = (s.tags || []).join(', ');
  const suggested = activeCategorySuggestion(s, state.categories);
  if (suggested) $('#category-select').value = suggested;
  const img = $('#page-thumb');
  if (s.thumbnail) { img.src = s.thumbnail; img.classList.remove('hidden'); $('#thumb-fallback').classList.add('hidden'); }
  else { img.classList.add('hidden'); $('#thumb-fallback').classList.remove('hidden'); }
  renderRelated();
}
function renderCategories() {
  $('#category-select').innerHTML = '<option value="">No category</option>' + state.categories.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
}
function renderSessionsSelect() {
  $('#session-select').innerHTML = '<option value="">Choose session…</option>' + state.sessions.map(s=>`<option value="${esc(s.id)}">${esc(s.name)} (${s.tabs?.length||0})</option>`).join('');
}
function renderRelated() {
  const rows = state.scan?.related || [];
  $('#related-count').textContent = String(rows.length);
  $('#related-list').innerHTML = rows.length ? rows.slice(0,16).map((r,i)=>`<div class="related-row" data-related="${i}">${r.thumbnail?`<img src="${esc(r.thumbnail)}" alt="">`:'<div class="idx">'+(i+1)+'</div>'}<div><b>${esc(r.title||'Related video')}</b><small>${esc(sourceFromUrl(r.url))}</small></div><button class="mini-save" data-save-related="${i}">＋</button></div>`).join('') : '<p class="muted">No related links were detected on this page.</p>';
  document.querySelectorAll('[data-save-related]').forEach(btn => btn.onclick = async e => {
    e.stopPropagation(); const r = rows[Number(btn.dataset.saveRelated)]; if (!r) return;
    try {
      const result = await saveItem(state.vaultId, { ...r, categories: $('#category-select').value ? [$('#category-select').value] : [], tags: [] }, { skipIfExists: true });
      setMessage('#save-msg', result.status === 'skipped' ? 'Related item already existed — skipped.' : 'Related item saved.', true);
    } catch (error) { setMessage('#save-msg', error.message); }
  });
  document.querySelectorAll('[data-related]').forEach(row => row.onclick = async e => {
    if (e.target.closest('[data-save-related]')) return;
    const r = rows[Number(row.dataset.related)];
    if (r?.url) await chrome.runtime.sendMessage({ type: 'NAVIGATE_ACTIVE', payload: { url: r.url, vaultId: state.vaultId } });
  });
}
async function refreshManaged() {
  const windowId = await getCurrentWindowId();
  const response = await chrome.runtime.sendMessage({ type: 'GET_MANAGED_STATE', payload: { windowId } });
  state.managed = response?.state || null;
  renderManaged();
}
function renderManaged() {
  const m = state.managed;
  $('#pool-badge').textContent = m ? `${m.maxActive} live / ${m.items.length} total` : 'No session';
  $('#session-items').innerHTML = m?.items?.length ? m.items.map((item,i)=>`<button class="session-row ${i===m.currentIndex?'active':''}" data-session-index="${i}"><span class="idx">${i+1}</span><span><b>${esc(item.title||item.url)}</b><small>${esc(sourceFromUrl(item.url))}${m.slots?.some(s=>s.itemIndex===i)?' · loaded':' · virtual'}</small></span><span>›</span></button>`).join('') : '<p class="muted">Open a saved session to create a RAM-conscious browser pool.</p>';
  document.querySelectorAll('[data-session-index]').forEach(btn => btn.onclick = async () => {
    const response = await chrome.runtime.sendMessage({ type: 'ACTIVATE_SESSION_INDEX', payload: { windowId: state.windowId, index: Number(btn.dataset.sessionIndex) } });
    if (!response?.ok) return setMessage('#save-msg', response?.error || 'Could not activate session item.');
    state.managed = response.state; renderManaged(); setTimeout(scanCurrentPage, 700);
  });
}
async function loadVaultData() {
  state.categories = await listCategories(state.vaultId);
  state.sessions = await listSessions(state.vaultId);
  state.settings = await getSettings().catch(() => ({ maxActiveTabs: 3 }));
  renderCategories(); renderSessionsSelect();
  document.body.classList.toggle('nsfw', Boolean(state.vault?.nsfw));
  $('#vault-name').textContent = state.vault?.name || 'Vault';
  await scanCurrentPage();
  await refreshManaged();
}
async function chooseVault(id) {
  state.vaultId = id;
  state.vault = state.vaults.find(v => v.id === id) || null;
  await chrome.storage.local.set({ noxExtensionVaultId: id });
  if (state.vault && !vaultHasPassword(state.vault)) {
    await setVaultUnlocked(id, true);
    show('main-view');
    await loadVaultData();
    return;
  }
  if (await isVaultUnlocked(id)) { show('main-view'); await loadVaultData(); }
  else { $('#vault-select').value = id; show('vault-view'); requestAnimationFrame(()=>$('#vault-password')?.focus()); }
}
async function bootstrap() {
  const config = await getRuntimeConfig();
  if (!configReady(config)) { show('setup-view'); return; }
  state.auth = await getAuth();
  if (!state.auth) { show('login-view'); return; }
  state.vaults = await listVaults();
  const saved = await chrome.storage.local.get('noxExtensionVaultId');
  const selected = state.vaults.find(v => v.id === saved.noxExtensionVaultId)?.id || state.vaults[0]?.id;
  $('#vault-select').innerHTML = state.vaults.map(v=>`<option value="${esc(v.id)}">${esc(v.name)}${vaultHasPassword(v)?' 🔒':''}</option>`).join('');
  if (!selected) { show('vault-view'); setMessage('#vault-msg','No vaults exist yet. Create one in the Nox web app.'); return; }
  await chooseVault(selected);
}

$('#open-options').onclick = () => chrome.runtime.openOptionsPage();
$('#close-sidebar').onclick = async () => {
  const tab = await currentTab();
  if (tab && tab.id) await chrome.tabs.sendMessage(tab.id, { type: 'NOX_HIDE_SIDEBAR' }).catch(() => {});
  await chrome.runtime.sendMessage({ type: 'SET_SIDEBAR_VISIBLE', payload: { windowId: state.windowId, visible: false } }).catch(() => {});
};
$('#setup-options').onclick = () => chrome.runtime.openOptionsPage();
$('#login-form').onsubmit = async e => {
  e.preventDefault(); setMessage('#login-msg','Signing in…');
  try { state.auth = await login($('#email').value, $('#password').value); setMessage('#login-msg','Signed in.',true); await bootstrap(); }
  catch (error) { setMessage('#login-msg', error.message); }
};
$('#vault-select').onchange = e => chooseVault(e.target.value);
$('#vault-form').onsubmit = async e => {
  e.preventDefault(); setMessage('#vault-msg','Checking password…');
  try {
    const id = $('#vault-select').value;
    state.vault = state.vaults.find(v=>v.id===id) || null;
    if (state.vault && !vaultHasPassword(state.vault)) {
      await setVaultUnlocked(id, true);
    } else if (!await verifyVaultPassword(id, $('#vault-password').value)) {
      throw new Error('Incorrect vault password.');
    }
    await setVaultUnlocked(id, true); state.vaultId = id; $('#vault-password').value=''; show('main-view'); await loadVaultData();
  } catch (error) { setMessage('#vault-msg', error.message); }
};
$('#change-vault').onclick = async () => { $('#vault-select').value = state.vaultId; show('vault-view'); };
$('#rescan').onclick = scanCurrentPage;
$('#open-web').onclick = async () => { const c=await getRuntimeConfig(); chrome.tabs.create({url:c.webAppUrl}); };
$('#save-current').onclick = async () => {
  setMessage('#save-msg','Saving…');
  try {
    const s = state.scan || await scanCurrentPage();
    const result = await saveItem(state.vaultId, {
      url: s.url || s.pageUrl,
      title: $('#save-title').value || s.title,
      source: s.source,
      thumbnail: s.thumbnail || '', embedUrl: s.embedUrl || '', mediaUrl: s.mediaUrl || '', duration: s.duration || '',
      categories: $('#category-select').value ? [$('#category-select').value] : [], tags: parseTags($('#tags').value),
      favorite: $('#favorite').checked, rating: Number($('#rating').value || 0), notes: $('#notes').value, related: s.related || []
    }, { skipIfExists: true });
    setMessage('#save-msg', result.status === 'skipped' ? 'Already saved — skipped.' : 'Saved to Nox Vault.', true);
  } catch (error) { setMessage('#save-msg', error.message); }
};
$('#save-window').onclick = async () => {
  setMessage('#save-msg','Scanning window tabs…');
  try {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const usable = tabs.filter(t=>/^https?:/i.test(t.url||'')); let saved=0, skipped=0, failed=0;
    for (const tab of usable) {
      try {
        let meta={url:tab.url,title:tab.title||tab.url,source:sourceFromUrl(tab.url),tags:[],related:[]};
        try { const r=await chrome.tabs.sendMessage(tab.id,{type:'NOX_SCAN_PAGE'}); if(r?.ok) meta=r.data; } catch {}
        const result=await saveItem(state.vaultId,{...meta,categories:$('#category-select').value?[ $('#category-select').value ]:[]},{skipIfExists:true});
        if(result.status==='skipped') skipped++; else saved++;
      } catch { failed++; }
    }
    setMessage('#save-msg',`${saved} saved · ${skipped} duplicates skipped${failed?` · ${failed} failed`:''}`,true);
  } catch (error) { setMessage('#save-msg',error.message); }
};
$('#save-managed').onclick = async () => {
  if(!state.managed?.items?.length) return setMessage('#save-msg','Open a managed Nox session first.');
  setMessage('#save-msg','Saving entire session…');
  let saved=0,skipped=0,failed=0;
  for(const item of state.managed.items){
    try{
      const result=await saveItem(state.vaultId,{url:item.url,title:item.title,thumbnail:item.thumbnail||'',tags:item.tags||[],categories:$('#category-select').value?[ $('#category-select').value ]:[]},{skipIfExists:true});
      if(result.status==='skipped')skipped++;else saved++;
    }catch{failed++}
  }
  setMessage('#save-msg',`${saved} saved · ${skipped} duplicates skipped${failed?` · ${failed} failed`:''}`,true);
};
$('#save-window-session').onclick = async () => {
  try {
    const tabs=(await chrome.tabs.query({currentWindow:true})).filter(t=>/^https?:/i.test(t.url||''));
    if(!tabs.length) throw new Error('No normal web tabs in this window.');
    const name=prompt('Session name','Browser Session'); if(!name)return;
    const row=await saveSession(state.vaultId,{name,tabs:tabs.map(t=>({id:uuid(),url:t.url,title:t.title||t.url,thumbnail:'',tags:[],categoryIds:[],status:'suspended'})),categoryIds:[]});
    state.sessions=await listSessions(state.vaultId); renderSessionsSelect(); $('#session-select').value=row.id; setMessage('#save-msg','Window saved as a Nox session.',true);
  } catch(error){ setMessage('#save-msg',error.message); }
};
$('#open-session').onclick = async () => {
  const id=$('#session-select').value; if(!id)return setMessage('#save-msg','Choose a saved session first.');
  try {
    const session=await getSession(state.vaultId,id); const response=await chrome.runtime.sendMessage({type:'OPEN_SESSION_OBJECT',payload:{vaultId:state.vaultId,session,maxActiveTabs:state.settings.maxActiveTabs||3}});
    if(!response?.ok)throw new Error(response?.error||'Could not open session.');
    setMessage('#save-msg',`Session opened with ${response.state.maxActive} live browser slots.`,true);
  } catch(error){setMessage('#save-msg',error.message)}
};
$('#prev-item').onclick = async()=>{if(!state.managed)return;const i=(state.managed.currentIndex-1+state.managed.items.length)%state.managed.items.length;const r=await chrome.runtime.sendMessage({type:'ACTIVATE_SESSION_INDEX',payload:{windowId:state.windowId,index:i}});if(r?.state){state.managed=r.state;renderManaged();setTimeout(scanCurrentPage,700)}};
$('#next-item').onclick = async()=>{if(!state.managed)return;const i=(state.managed.currentIndex+1)%state.managed.items.length;const r=await chrome.runtime.sendMessage({type:'ACTIVATE_SESSION_INDEX',payload:{windowId:state.windowId,index:i}});if(r?.state){state.managed=r.state;renderManaged();setTimeout(scanCurrentPage,700)}};
$('#random-item').onclick = async()=>{if(!state.managed)return;const i=Math.floor(Math.random()*state.managed.items.length);const r=await chrome.runtime.sendMessage({type:'ACTIVATE_SESSION_INDEX',payload:{windowId:state.windowId,index:i}});if(r?.state){state.managed=r.state;renderManaged();setTimeout(scanCurrentPage,700)}};
$('#panic').onclick = async()=>{await chrome.runtime.sendMessage({type:'PANIC',payload:{windowId:state.windowId}}).catch(()=>{});};
$('#restore-hidden').onclick = async()=>{const r=await chrome.runtime.sendMessage({type:'RESTORE_PANIC'});if(!r?.ok)setMessage('#save-msg',r?.error||'Nothing to restore.');};
$('#logout').onclick = async()=>{await logout();state.auth=null;show('login-view');};

chrome.tabs.onActivated.addListener(info=>{if(info.windowId===state.windowId){setTimeout(()=>{scanCurrentPage();refreshManaged();},350)}});
chrome.tabs.onUpdated.addListener((tabId,change,tab)=>{if(tab.windowId===state.windowId&&(change.status==='complete'||change.url)){setTimeout(scanCurrentPage,500)}});

bootstrap().catch(error=>{show('login-view');setMessage('#login-msg',error.message);});
