// Nox Vault v1.2 embedded-browser/session update 2026-09-15
import {backend} from './backend-v7.js';
import {$,$$,esc,fmtDate,timeAgo,uid,nowIso,normalizeUrl,sourceFromUrl,isDirectVideo,isHls,parseTags,shortcutMatches,prettyShortcut,downloadBlob,pickFile,sortBy,randomSubset} from './utils-v7.js';

const S={
  settings:null,vaults:[],currentVaultId:null,categories:[],items:[],sessions:[],notes:[],images:[],
  unlocked:new Set(),route:'dashboard',search:'',activeSession:null,currentTabId:null,tabFrames:new Map(),
  playerQueue:[],playerIndex:0,playerMode:'order',idleTimer:null,lastActivity:Date.now(),
};
const appShell=$('#app-shell'),authScreen=$('#auth-screen'),page=$('#page'),vaultSwitcher=$('#vault-switcher'),activeLimitTop=$('#top-active-limit');
const currentVault=()=>S.vaults.find(v=>v.id===S.currentVaultId)||null;
const currentCat=id=>S.categories.find(c=>c.id===id);
const byId=(arr,id)=>arr.find(x=>x.id===id);

function toast(message,type=''){const el=document.createElement('div');el.className=`toast ${type}`;el.textContent=message;$('#toast-root').append(el);setTimeout(()=>el.remove(),4200)}
function modal(html,{wide=false,onOpen}={}){const tpl=$('#modal-template').content.cloneNode(true);const back=tpl.querySelector('.modal-backdrop'),box=tpl.querySelector('.modal');if(wide)box.style.width='min(900px,100%)';tpl.querySelector('.modal-body').innerHTML=html;tpl.querySelector('.modal-close').onclick=()=>back.remove();back.addEventListener('click',e=>{if(e.target===back)back.remove()});$('#modal-root').append(tpl);onOpen?.(back);return back}
function confirmModal(title,text,yes='Confirm'){return new Promise(resolve=>{const m=modal(`<h2>${esc(title)}</h2><p>${esc(text)}</p><div class="form-actions"><button class="btn ghost cancel">Cancel</button><button class="btn danger ok">${esc(yes)}</button></div>`,{onOpen:r=>{r.querySelector('.cancel').onclick=()=>{r.remove();resolve(false)};r.querySelector('.ok').onclick=()=>{r.remove();resolve(true)}}});})}
function setBusy(btn,busy,label='Working…'){if(!btn)return;btn.disabled=busy;if(busy){btn.dataset.old=btn.textContent;btn.textContent=label}else{btn.textContent=btn.dataset.old||btn.textContent}}
function routeTo(r){location.hash=r.startsWith('#')?r:`#${r}`}
function parseRoute(){const h=location.hash.replace(/^#/,'')||'dashboard';const [name,id]=h.split('/');return {name,id}}
function applySettings(){
  activeLimitTop.value=String(S.settings.maxActiveTabs||3);
  localStorage.setItem('nox_panic_shortcut',S.settings.panicShortcut||'Ctrl+Shift+Space');
  $('#panic-shortcut-label').textContent=prettyShortcut(S.settings.panicShortcut||'Ctrl+Shift+Space');
  // v1.1 intentionally shows saved media previews. Old blur settings are ignored.
  document.body.classList.remove('blur-media');
}
function refreshVaultSwitcher(){vaultSwitcher.innerHTML=S.vaults.map(v=>`<option value="${esc(v.id)}">${esc(v.name)}${S.unlocked.has(v.id)?'':' 🔒'}</option>`).join('')||'<option>No vaults</option>';if(S.currentVaultId)vaultSwitcher.value=S.currentVaultId}
async function loadVaultData(){if(!S.currentVaultId){S.categories=[];S.items=[];S.sessions=[];S.notes=[];S.images=[];return}await backend.seedDefaultCategories(S.currentVaultId);[S.categories,S.items,S.sessions,S.notes,S.images]=await Promise.all([backend.listCategories(S.currentVaultId),backend.listItems(S.currentVaultId,true),backend.listSessions(S.currentVaultId),backend.listNotes(S.currentVaultId),backend.listImages(S.currentVaultId)]);}
async function loadAppData(){
  S.settings=await backend.getSettings();
  if(S.settings.blurThumbnails){
    S.settings.blurThumbnails=false;
    backend.saveSettings({blurThumbnails:false}).catch(()=>{});
  }
  S.vaults=await backend.listVaults();
  S.currentVaultId=localStorage.getItem('nox_current_vault')||S.vaults[0]?.id||null;
  if(S.currentVaultId&&!S.vaults.some(v=>v.id===S.currentVaultId))S.currentVaultId=S.vaults[0]?.id||null;
  const decoyUnlocked=sessionStorage.getItem('nox_decoy_unlocked_vault');
  if(decoyUnlocked&&decoyUnlocked===S.currentVaultId){
    S.unlocked.add(decoyUnlocked);
    sessionStorage.removeItem('nox_decoy_unlocked_vault');
  }
  await loadVaultData();
  refreshVaultSwitcher();
  applySettings();
}

function unloadFrames(){for(const f of S.tabFrames.values()){try{f.src='about:blank';f.remove()}catch{}}S.tabFrames.clear()}
function lockVault(vaultId,{decoy=false}={}){if(!vaultId)return;S.unlocked.delete(vaultId);if(vaultId===S.currentVaultId){unloadFrames();S.activeSession=null;S.currentTabId=null}refreshVaultSwitcher();if(decoy||S.settings?.decoyOnLock)location.href='./decoy.html';else showVaultLock(vaultId)}
function lockAll(opts={}){[...S.unlocked].forEach(id=>S.unlocked.delete(id));unloadFrames();refreshVaultSwitcher();if(opts.decoy||S.settings?.decoyOnLock)location.href='./decoy.html';else render()}
function showVaultLock(vaultId){const v=byId(S.vaults,vaultId);if(!v)return;const old=$('.lock-overlay');old?.remove();const wrap=document.createElement('div');wrap.className='lock-overlay';wrap.innerHTML=`<div class="lock-card glass"><img src="./assets/nox-mark.svg" alt=""><h2>${esc(v.name)}</h2><p>This vault is locked. Enter its vault password to continue.</p><form><input type="password" name="password" autocomplete="current-password" placeholder="Vault password" required><button class="btn primary" type="submit">Unlock Vault</button><button class="btn ghost" type="button" data-vaults>Back to Vaults</button><p class="form-message"></p></form></div>`;document.body.append(wrap);wrap.querySelector('[data-vaults]').onclick=()=>{wrap.remove();routeTo('vaults')};wrap.querySelector('form').onsubmit=async e=>{e.preventDefault();const btn=e.submitter,msg=wrap.querySelector('.form-message');setBusy(btn,true,'Checking…');try{const ok=await backend.verifyVault(vaultId,e.target.password.value);if(!ok)throw new Error('Incorrect vault password.');S.unlocked.add(vaultId);await backend.touchVault(vaultId);wrap.remove();refreshVaultSwitcher();render()}catch(err){msg.textContent=err.message}finally{setBusy(btn,false)}}}
async function ensureUnlocked(){if(!S.currentVaultId)return false;if(S.unlocked.has(S.currentVaultId))return true;showVaultLock(S.currentVaultId);return false}

function pageHeader(title,subtitle='',actions=''){return `<div class="page-header"><div class="page-title"><h1>${title}</h1><p>${subtitle}</p></div><div class="page-actions">${actions}</div></div>`}
function thumb(item=null,cls='thumb'){
  const src=item?.thumbnail||item?.thumbnailDataUrl||'';
  if(src)return `<div class="${cls} media-preview"><img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer"></div>`;
  return `<div class="${cls} media-preview empty-preview"></div>`;
}
function badge(text,cls='blue'){return `<span class="badge ${cls}">${esc(text)}</span>`}
function catName(id){return currentCat(id)?.name||'Uncategorised'}
function itemCategories(item){return (item.categories||[]).map(catName)}
function activeItems(){return S.items.filter(i=>!i.deletedAt)}

function renderDashboard(){
  const v=currentVault(),items=activeItems(),favorites=items.filter(i=>i.favorite).length,activeCount=S.activeSession?.tabs?.filter(t=>t.status==='active').length||0;
  const recentSessions=sortBy(S.sessions,'updatedAt').slice(0,4),recentItems=sortBy(items,'createdAt').slice(0,3);
  page.innerHTML=`${pageHeader('<span class="greeting">Good evening.</span>','Your private space is ready.')}
  <div class="stats">
    <div class="stat-card"><div class="stat-icon">♧</div><div><strong>${items.length}</strong><small>Saved Items</small><small class="delta">+ ready to find</small></div></div>
    <div class="stat-card"><div class="stat-icon">▣</div><div><strong>${S.vaults.length}</strong><small>Vaults</small><small>${S.vaults.length-S.unlocked.size} locked</small></div></div>
    <div class="stat-card"><div class="stat-icon">◉</div><div><strong>${activeCount} / ${S.settings.maxActiveTabs}</strong><small>Active Tabs</small><small>${S.activeSession?.tabs?.filter(t=>t.status==='suspended').length||0} suspended</small></div></div>
    <div class="stat-card"><div class="stat-icon">☆</div><div><strong>${favorites}</strong><small>Favorites</small><small>${S.categories.length} categories</small></div></div>
    <div class="stat-card"><div class="stat-icon">◴</div><div><strong>${S.images.length}</strong><small>Images</small><div class="progress"><i style="width:${Math.min(100,S.images.length*2)}%"></i></div></div></div>
  </div>
  <div class="dashboard-grid">
    <div class="stack">
      <section class="card panel"><div class="panel-title"><h2>Recent Sessions</h2><a href="#sessions">View All →</a></div><div class="session-strip">${recentSessions.length?recentSessions.map(s=>`<button class="session-card" data-open-session="${s.id}">${thumb((s.tabs||[]).find(t=>t.thumbnail)||null)}<h3>${esc(s.name)}</h3><p>${s.tabs?.length||0} tabs · ${timeAgo(s.updatedAt)}</p></button>`).join(''):`<div class="empty" style="grid-column:1/-1"><div><strong>No sessions yet</strong>Create a session and add a URL.</div></div>`}</div></section>
      <section class="card panel"><div class="panel-title"><h2>Recently Saved</h2><a href="#library">View All →</a></div><div class="recent-list">${recentItems.length?recentItems.map(i=>`<div class="recent-row">${thumb(i,'mini-thumb')}<div><strong>${esc(i.title)}</strong><small>${esc(i.source||'link')} · ${timeAgo(i.createdAt)}</small></div><button class="btn icon small" data-view-item="${i.id}">›</button></div>`).join(''):`<div class="empty"><div><strong>Nothing saved yet</strong>Save a tab or link from a session.</div></div>`}</div></section>
    </div>
    <div class="stack">
      <section class="card panel"><div class="panel-title"><h2>Vault Status</h2><a href="#vaults">Manage</a></div><div class="vault-list">${S.vaults.slice(0,5).map(x=>`<div class="vault-row"><div class="vault-dot">▱</div><div><strong>${esc(x.name)}</strong><small>${x.id===v?.id?'Current vault':timeAgo(x.lastOpenedAt)}</small></div>${badge(S.unlocked.has(x.id)?'Active':'Locked',S.unlocked.has(x.id)?'green':'red')}</div>`).join('')}</div></section>
      <section class="card panel"><div class="panel-title"><h2>Quick Actions</h2></div><div class="quick-grid"><button class="quick" data-new-session><strong>▣ New Session</strong><small>Start browsing</small></button><button class="quick" data-open-player><strong>▷ Open Player</strong><small>Playlist / random</small></button><button class="quick" data-add-note><strong>✎ New Note</strong><small>Quick note</small></button><button class="quick" data-add-image><strong>▧ Import Image</strong><small>Camera / upload / URL</small></button></div><button class="btn danger wide" style="margin-top:9px" data-panic>◉̸ Panic Hide</button></section>
      <section class="card panel"><div class="panel-title"><h2>Privacy Status</h2><span class="smalltext" style="color:var(--green)">Ready</span></div><div class="status-list"><div class="status-line"><span><i></i>Firebase rules</span><b>Owner only</b></div><div class="status-line"><span><i></i>Auto-lock</span><b>${S.settings.inactivityMinutes} min</b></div><div class="status-line"><span><i></i>Panic hide</span><b>${prettyShortcut(S.settings.panicShortcut)}</b></div><div class="status-line"><span><i></i>Vault lock</span><b>${S.unlocked.has(S.currentVaultId)?'Unlocked':'Locked'}</b></div></div></section>
    </div>
  </div>`;
  $$('[data-open-session]').forEach(b=>b.onclick=()=>openSessionById(b.dataset.openSession));$$('[data-view-item]').forEach(b=>b.onclick=()=>showItemDetail(b.dataset.viewItem));$('[data-new-session]',page)?.addEventListener('click',newSessionModal);$('[data-open-player]',page)?.addEventListener('click',()=>routeTo('player'));$('[data-add-note]',page)?.addEventListener('click',()=>noteModal('note'));$('[data-add-image]',page)?.addEventListener('click',imageAddModal);$('[data-panic]',page)?.addEventListener('click',panic);
}
function renderVaults(){
  page.innerHTML=`${pageHeader('Your Vaults','Separate spaces for sessions, saved items, images and notes.','<button class="btn primary" data-new-vault>＋ New Vault</button>')}
  <div class="vault-grid">${S.vaults.map(v=>`<section class="card vault-card ${v.id===S.currentVaultId?'selected':''}"><div class="spaced"><div class="vault-lock">${S.unlocked.has(v.id)?'🔓':'🔒'}</div>${badge(S.unlocked.has(v.id)?'Active':'Locked',S.unlocked.has(v.id)?'green':'red')}</div><h3>${esc(v.name)}</h3><p>${esc(v.description||'Private vault')}</p><div class="vault-actions"><small class="muted">${timeAgo(v.lastOpenedAt)}</small><div><button class="btn small ${S.unlocked.has(v.id)?'outline':'primary'}" data-vault-open="${v.id}">${S.unlocked.has(v.id)?'Open':'Unlock'} →</button> <button class="btn small ghost" data-vault-menu="${v.id}">•••</button></div></div></section>`).join('')}<button class="card vault-card create-card" data-new-vault><div><b>＋</b><h3>New Vault</h3><small>Create another private space</small></div></button></div>`;
  $$('[data-new-vault]',page).forEach(b=>b.onclick=newVaultModal);$$('[data-vault-open]',page).forEach(b=>b.onclick=()=>selectVault(b.dataset.vaultOpen));$$('[data-vault-menu]',page).forEach(b=>b.onclick=e=>vaultMenu(e,b.dataset.vaultMenu));
}
async function selectVault(id){S.currentVaultId=id;localStorage.setItem('nox_current_vault',id);await loadVaultData();refreshVaultSwitcher();history.replaceState(null,'','#dashboard');if(!S.unlocked.has(id)){showVaultLock(id);return}await backend.touchVault(id);render()}
function newVaultModal(){modal(`<h2>Create New Vault</h2><p>Each vault has its own password. This password is an application lock, not client-side encryption.</p><form id="vault-form" class="form-grid"><label>Vault name<input name="name" required maxlength="60" placeholder="Personal"></label><label>Accent colour<input name="color" type="color" value="#3377ff"></label><label class="full">Description<input name="description" maxlength="140" placeholder="Optional description"></label><label class="full">Vault password<input name="password" type="password" required minlength="4" autocomplete="new-password"></label><div class="form-actions full"><button class="btn ghost" type="button" data-close>Cancel</button><button class="btn primary" type="submit">Create Vault</button></div></form>`,{onOpen:r=>{r.querySelector('[data-close]').onclick=()=>r.remove();r.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;setBusy(b,true,'Creating…');try{const d=Object.fromEntries(new FormData(e.target));const id=await backend.createVault(d);S.vaults=await backend.listVaults();S.currentVaultId=id;S.unlocked.add(id);localStorage.setItem('nox_current_vault',id);await loadVaultData();r.remove();refreshVaultSwitcher();toast('Vault created.','success');render()}catch(err){toast(err.message,'error')}finally{setBusy(b,false)}}}})}
function vaultMenu(e,id){openContext(e,[['Rename / edit',()=>editVaultModal(id)],['Change password',()=>changeVaultPasswordModal(id)],['Lock',()=>lockVault(id,{decoy:false})],['Delete vault',async()=>{if(await confirmModal('Delete vault?','This permanently removes the vault and all Firestore records inside it, including stored image chunks.','Delete Vault')){await backend.deleteVault(id);S.unlocked.delete(id);S.vaults=await backend.listVaults();if(S.currentVaultId===id){S.currentVaultId=S.vaults[0]?.id||null;localStorage.setItem('nox_current_vault',S.currentVaultId||'');await loadVaultData()}refreshVaultSwitcher();render();toast('Vault deleted.')}}]])}
function editVaultModal(id){const v=byId(S.vaults,id);modal(`<h2>Edit Vault</h2><form class="form-grid"><label>Vault name<input name="name" value="${esc(v.name)}" required></label><label>Accent colour<input name="color" type="color" value="${esc(v.color||'#3377ff')}"></label><label class="full">Description<input name="description" value="${esc(v.description||'')}"></label><div class="form-actions full"><button class="btn primary">Save</button></div></form>`,{onOpen:r=>r.querySelector('form').onsubmit=async e=>{e.preventDefault();await backend.updateVault(id,Object.fromEntries(new FormData(e.target)));S.vaults=await backend.listVaults();r.remove();refreshVaultSwitcher();render();toast('Vault updated.','success')}})}
function changeVaultPasswordModal(id){modal(`<h2>Change Vault Password</h2><p>This changes the vault access password. It does not encrypt the stored Firebase data.</p><form><input name="password" type="password" minlength="4" required placeholder="New vault password"><div class="form-actions"><button class="btn primary">Change Password</button></div></form>`,{onOpen:r=>r.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;setBusy(b,true);try{await backend.changeVaultPassword(id,e.target.password.value);r.remove();toast('Vault password changed.','success')}catch(err){toast(err.message,'error')}finally{setBusy(b,false)}}})}
function openContext(e,entries){$('.context-menu')?.remove();const m=document.createElement('div');m.className='context-menu';m.innerHTML=entries.map((x,i)=>`<button data-i="${i}" class="${/delete/i.test(x[0])?'danger':''}">${esc(x[0])}</button>`).join('');document.body.append(m);const r=e.currentTarget?.getBoundingClientRect?.()||{left:e.clientX,top:e.clientY,bottom:e.clientY};m.style.left=`${Math.min(innerWidth-210,r.left)}px`;m.style.top=`${Math.min(innerHeight-m.offsetHeight-10,r.bottom+5)}px`;m.onclick=ev=>{const b=ev.target.closest('button');if(!b)return;const fn=entries[Number(b.dataset.i)][1];m.remove();fn()};setTimeout(()=>addEventListener('click',()=>m.remove(),{once:true}),0)}

function renderSessions(){
  page.innerHTML=`${pageHeader('Sessions','Open-tab groups. Restore large sessions safely without loading every page at once.','<button class="btn primary" data-new-session>＋ New Session</button>')}
  <div class="notice">Your active-tab limit is <b>${S.settings.maxActiveTabs}</b>. Suspended tabs keep only lightweight state until activated.</div><div style="height:12px"></div>
  <div class="content-grid">${S.sessions.length?sortBy(S.sessions,'updatedAt').map(s=>`<article class="media-card">${thumb((s.tabs||[]).find(t=>t.thumbnail)||null)}<div class="media-body"><h3>${esc(s.name)}</h3><p>${s.tabs?.length||0} tabs · ${(s.categoryIds||[]).map(catName).join(', ')||'No category'}</p><div class="media-meta"><span>${timeAgo(s.updatedAt)}</span><span><button class="btn small primary" data-open-session="${s.id}">Open</button> <button class="btn small ghost" data-session-menu="${s.id}">•••</button></span></div></div></article>`).join(''):`<div class="empty" style="grid-column:1/-1"><div><strong>No sessions yet</strong>Create one to start browsing with managed tabs.</div></div>`}</div>`;
  $('[data-new-session]',page).onclick=newSessionModal;$$('[data-open-session]',page).forEach(b=>b.onclick=()=>openSessionById(b.dataset.openSession));$$('[data-session-menu]',page).forEach(b=>b.onclick=e=>openContext(e,[['Open',()=>openSessionById(b.dataset.sessionMenu)],['Duplicate',()=>duplicateSession(b.dataset.sessionMenu)],['Delete',()=>deleteSession(b.dataset.sessionMenu)]]));
}
function newSessionModal(){modal(`<h2>New Session</h2><form class="form-grid"><label class="full">Session name<input name="name" required placeholder="Weekend Session"></label><label class="full">Category<select name="categoryId" class="select"><option value="">No category</option>${S.categories.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></label><div class="form-actions full"><button class="btn primary">Create & Open</button></div></form>`,{onOpen:r=>r.querySelector('form').onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));const s=await backend.saveSession(S.currentVaultId,{name:d.name,tabs:[],categoryIds:d.categoryId?[d.categoryId]:[]});S.sessions=await backend.listSessions(S.currentVaultId);r.remove();openSessionById(s.id)}})}
async function duplicateSession(id){const s=byId(S.sessions,id);if(!s)return;const copy=await backend.saveSession(S.currentVaultId,{name:`${s.name} Copy`,tabs:(s.tabs||[]).map(t=>({...t,id:uid(),status:'suspended'})),categoryIds:s.categoryIds||[]});S.sessions=await backend.listSessions(S.currentVaultId);toast('Session duplicated.','success');openSessionById(copy.id)}
async function deleteSession(id){if(!(await confirmModal('Delete session?','Saved library items are not affected.','Delete')))return;await backend.deleteSession(S.currentVaultId,id);S.sessions=await backend.listSessions(S.currentVaultId);if(S.activeSession?.id===id){S.activeSession=null;unloadFrames()}render()}
function normalizeSession(s){
  const tabs=(s.tabs||[]).map(t=>{
    const local=backend.resolveUrl(t.url||'');
    return {
      id:t.id||uid(),url:t.url||'',title:t.title||local.title||sourceFromUrl(t.url),
      embedUrl:t.embedUrl||local.embedUrl||'',mediaUrl:t.mediaUrl||local.mediaUrl||'',thumbnail:t.thumbnail||local.thumbnail||'',
      playbackMode:t.playbackMode||'auto',related:Array.isArray(t.related)?t.related:[],
      metadataCheckedAt:t.metadataCheckedAt||null,status:t.status||'suspended',
      pinned:!!t.pinned,lastActiveAt:t.lastActiveAt||0,
      tags:[...new Set([...(t.tags||[]),...(local.tags||[])])].slice(0,30),categoryIds:t.categoryIds||[]
    };
  });
  let active=tabs.filter(t=>t.status==='active');
  if(!active.length&&tabs.length)tabs.slice(0,Math.min(S.settings.maxActiveTabs,tabs.length)).forEach(t=>t.status='active');
  active=tabs.filter(t=>t.status==='active');
  if(active.length>S.settings.maxActiveTabs)active.slice(S.settings.maxActiveTabs).forEach(t=>t.status='suspended');
  return {...s,tabs};
}

async function openSessionById(id){
  if(!id)return;
  try{
    S.sessions=await backend.listSessions(S.currentVaultId);
    const target=S.sessions.find(x=>x.id===id);
    if(!target)throw new Error('Session not found.');
    const hash=`#session/${id}`;
    if(location.hash!==hash)history.pushState(null,'',hash);
    await openSessionPage(id,true);
  }catch(err){
    console.error('Open session failed:',err);
    toast(err.message||'Could not open session.','error');
  }
}
async function openSessionPage(id,force=false){
  let s=byId(S.sessions,id);
  if(!s){
    S.sessions=await backend.listSessions(S.currentVaultId);
    s=byId(S.sessions,id);
  }
  if(!s){toast('Session not found.','error');routeTo('sessions');return}
  if(force||!S.activeSession||S.activeSession.id!==id){
    unloadFrames();
    S.activeSession=normalizeSession({...s,tabs:(s.tabs||[]).map(t=>({...t}))});
    S.currentTabId=S.activeSession.tabs.find(t=>t.status==='active')?.id||S.activeSession.tabs[0]?.id||null;
    S.activeSession.lastOpenedAt=nowIso();
    await saveActiveSession(false);
  }
  renderSessionView();
  const current=byId(S.activeSession.tabs,S.currentTabId);
  if(current)queueAutoDetect(current);
}
async function saveActiveSession(showToast=true){if(!S.activeSession)return;const saved=await backend.saveSession(S.currentVaultId,S.activeSession);const idx=S.sessions.findIndex(x=>x.id===saved.id);if(idx>=0)S.sessions[idx]={...S.sessions[idx],...saved};else S.sessions.push(saved);if(showToast)toast('Session saved.','success')}
function playbackChoice(tab){
  const mode=tab?.playbackMode||'auto';
  const local=backend.resolveUrl(tab?.url||'');
  const embed=tab?.embedUrl||local.embedUrl||'';
  const direct=tab?.mediaUrl||local.mediaUrl||'';
  if(mode==='webpage')return {kind:'iframe',url:tab?.url||'',mode:'webpage'};
  if(mode==='embed')return {kind:'iframe',url:embed||tab?.url||'',mode:embed?'embed':'webpage'};
  if(mode==='direct')return {kind:'video',url:direct||tab?.url||'',mode:'direct'};
  if(direct&&(isDirectVideo(direct)||isHls(direct)))return {kind:'video',url:direct,mode:'direct'};
  if(S.settings?.preferDetectedPlayer!==false&&embed)return {kind:'iframe',url:embed,mode:'embed'};
  return {kind:'iframe',url:tab?.url||embed||'',mode:'webpage'};
}
function frameSandbox(choice){
  // Keep third-party pages/players inside Nox instead of allowing them to navigate
  // the top-level GitHub Pages tab or spawn a popup. Scripts/same-origin remain enabled
  // so normal embedded players can function.
  if(choice?.kind!=='iframe')return '';
  return 'allow-scripts allow-same-origin allow-forms allow-presentation allow-pointer-lock allow-downloads';
}
function titleTokens(value=''){
  const stop=new Set(['https','http','www','com','video','videos','watch','the','and','for','with','from','this','that','xhamster','pornhub']);
  return new Set(String(value).toLowerCase().split(/[^a-z0-9]+/).filter(x=>x.length>2&&!stop.has(x)));
}
function localRelated(tab){
  if(!tab)return [];
  const currentUrl=normalizeUrl(tab.url||'');
  const tagSet=new Set((tab.tags||[]).map(x=>String(x).toLowerCase()));
  const words=titleTokens(`${tab.title||''} ${tab.url||''}`);
  const source=sourceFromUrl(tab.url||'');
  const scored=[];
  for(const item of activeItems()){
    if(!item?.url||normalizeUrl(item.url)===currentUrl)continue;
    let score=0;
    const itemTags=(item.tags||[]).map(x=>String(x).toLowerCase());
    for(const t of itemTags)if(tagSet.has(t))score+=4;
    const iw=titleTokens(`${item.title||''} ${item.url||''}`);
    for(const w of iw)if(words.has(w))score+=2;
    if(source&&sourceFromUrl(item.url)===source)score+=1;
    if(score>0)scored.push({score,title:item.title,url:item.url,thumbnail:item.thumbnail||'',embedUrl:item.embedUrl||'',mediaUrl:item.mediaUrl||'',tags:item.tags||[],source:item.source||sourceFromUrl(item.url)});
  }
  const fromSaved=scored.sort((a,b)=>b.score-a.score).slice(0,8);
  const merged=[...(tab.related||[]),...fromSaved];
  const seen=new Set();
  return merged.filter(r=>{const key=normalizeUrl(r?.url||'');if(!key||key===currentUrl||seen.has(key))return false;seen.add(key);return true}).slice(0,8);
}

function renderRelated(related=[]){
  if(!related.length)return '<p class="muted smalltext">No related saved items yet. Switch to <b>Full webpage</b> to see the source site&apos;s own related section when that page permits iframe viewing.</p>';
  return related.slice(0,8).map((r,i)=>`<button class="related-row" data-related="${i}">${thumb(r,'mini-thumb')}<div><b>${esc(r.title||sourceFromUrl(r.url))}</b><small>${esc(sourceFromUrl(r.url))}</small></div><span>＋</span></button>`).join('');
}
function renderSessionView(){
  const s=S.activeSession;
  if(!s){routeTo('sessions');return}
  const current=byId(s.tabs,S.currentTabId);
  const choice=current?playbackChoice(current):null;
  const related=current?localRelated(current):[];
  page.innerHTML=`${pageHeader(`Session: ${esc(s.name)}`,`${s.tabs.length} tabs · ${s.tabs.filter(t=>t.status==='active').length} active · ${s.tabs.filter(t=>t.status==='suspended').length} suspended`,`<button class="btn ghost" data-save-all>Save All</button><button class="btn ghost" data-suspend-all>Suspend All</button><button class="btn primary" data-add-tab>＋ Tab</button>`) }
  <div class="session-layout">
    <section class="card browser-card">
      <div class="browser-tabs">${s.tabs.map((t,i)=>`<button class="browser-tab ${t.id===S.currentTabId?'active':''} ${t.status==='suspended'?'suspended':''}" data-tab="${t.id}"><span>${i+1}</span><b>${esc(t.title||'New Tab')}</b><span class="x" data-close-tab="${t.id}">×</span></button>`).join('')}<button class="browser-tab" data-add-tab>＋</button></div>
      <div class="address-row"><button class="btn icon small" data-back>←</button><button class="btn icon small" data-reload>↻</button><input id="session-url" type="url" placeholder="Enter a website, embed, MP4/WebM, or HLS URL…" value="${esc(current?.url||'')}"><button class="btn small primary" data-go>Go</button></div>
      <div class="browser-modebar">
        <span class="muted smalltext">Playback</span>
        <select id="playback-mode" class="select compact" ${current?'':'disabled'}>
          ${[['auto','Auto'],['webpage','Full webpage'],['embed','Detected embed'],['direct','Direct media']].map(([v,n])=>`<option value="${v}" ${current?.playbackMode===v?'selected':''}>${n}</option>`).join('')}
        </select>
        ${(current?.embedUrl||backend.resolveUrl(current?.url||'').embedUrl)?badge('Embed ready','green'):badge('Webpage mode','purple')}
        ${current?.mediaUrl?badge('Media detected','green'):''}
        ${current?`<button class="btn small ${choice?.mode==='embed'?'primary':'ghost'}" data-use-player>Player</button><button class="btn small ${choice?.mode==='webpage'?'primary':'ghost'}" data-use-webpage>Full webpage</button>`:''}
      </div>
      <div class="browser-stage" id="browser-stage"><div class="browser-placeholder"><div><img src="./assets/nox-mark.svg" width="70" alt=""><h2>${current?'Loading current tab…':'Open a tab'}</h2><p>Nox Vault first tries a detected player/direct stream and otherwise loads the original webpage in an iframe. Sites can still block embedding with their own browser security headers.</p></div></div></div>
      <div class="browser-toolbar"><button class="btn small primary" data-save-tab>☆ Save to Vault</button><button class="btn small ghost" data-metadata>↻ Detect Player & Metadata</button><button class="btn small ghost" data-note-tab>✎ Note</button><button class="btn small ghost" data-pin-tab>${current?.pinned?'Unpin':'Pin'}</button><div class="tab-dots"><span class="dot active"></span> Active ${s.tabs.filter(t=>t.status==='active').length}<span class="dot suspended"></span> Suspended ${s.tabs.filter(t=>t.status==='suspended').length}</div></div>
    </section>
    <aside class="session-side">
      <section class="card side-section"><h3>Current Tab</h3>${current?`<div class="tab-info">${thumb(current,'tab-side-thumb')}<strong>${esc(current.title||current.url)}</strong><small class="muted mono">${esc(current.url)}</small><div class="tag-cloud">${(current.tags||[]).slice(0,8).map(t=>badge(t,'blue')).join('')||'<span class="muted smalltext">No tags detected yet</span>'}</div><div class="spaced"><span>${badge(current.status,current.status==='active'?'green':'purple')}</span><button class="btn small ghost" data-toggle-active>${current.status==='active'?'Suspend':'Activate'}</button></div></div>`:'<p class="muted">No current tab.</p>'}</section>
      <section class="card side-section"><h3>Related in your vault</h3><div class="related-list">${renderRelated(related)}</div></section>
      <section class="card side-section"><h3>LRU Activation Queue</h3><div class="queue">${s.tabs.filter(t=>t.status==='suspended').sort((a,b)=>(a.lastActiveAt||0)-(b.lastActiveAt||0)).map((t,i)=>`<div class="queue-row"><span>${i+1}</span><b>${esc(t.title||sourceFromUrl(t.url))}</b><button class="btn small ghost" data-activate="${t.id}">▶</button></div>`).join('')||'<span class="muted smalltext">No suspended tabs.</span>'}</div></section>
      <section class="card side-section"><h3>Memory Policy</h3><div class="memory-meter"><div class="ring-wrap"><div class="ring" style="background:conic-gradient(var(--blue2) 0 ${Math.min(100,(s.tabs.filter(t=>t.status==='active').length/S.settings.maxActiveTabs)*100)}%,#18304e 0)"></div><strong>${s.tabs.filter(t=>t.status==='active').length}/${S.settings.maxActiveTabs}</strong></div><div><p class="muted smalltext">Only active tabs keep their iframe/player mounted. Suspended tabs are unloaded.</p><button class="btn small outline" data-limit-settings>Change limit</button></div></div></section>
    </aside>
  </div>`;
  hydrateSessionFrames();
  $$('[data-tab]',page).forEach(b=>b.onclick=e=>{if(e.target.closest('[data-close-tab]'))return;activateTab(b.dataset.tab)});
  $$('[data-close-tab]',page).forEach(b=>b.onclick=e=>{e.stopPropagation();closeTab(b.dataset.closeTab)});
  $$('[data-add-tab]',page).forEach(b=>b.onclick=addTabModal);
  $('[data-go]',page).onclick=()=>navigateCurrent($('#session-url').value);
  $('#session-url').onkeydown=e=>{if(e.key==='Enter')navigateCurrent(e.currentTarget.value)};
  $('[data-back]',page).onclick=()=>{const f=S.tabFrames.get(S.currentTabId);try{if(f?.tagName==='IFRAME')f.contentWindow.history.back()}catch{}};
  $('[data-reload]',page).onclick=()=>reloadCurrent();
  $('[data-save-tab]',page).onclick=()=>current&&saveItemModal(current);
  $('[data-save-all]',page).onclick=saveAllTabsModal;
  $('[data-suspend-all]',page).onclick=()=>suspendAllTabs();
  $('[data-metadata]',page).onclick=()=>current&&metadataIntoTab(current,true);
  $('[data-note-tab]',page).onclick=()=>current&&noteModal('note',{title:`Note: ${current.title}`,body:current.url});
  $('[data-pin-tab]',page).onclick=()=>{if(current){current.pinned=!current.pinned;saveActiveSession(false);renderSessionView()}};
  $('[data-toggle-active]',page)?.addEventListener('click',()=>current&&(current.status==='active'?suspendTab(current.id):activateTab(current.id)));
  $$('[data-activate]',page).forEach(b=>b.onclick=()=>activateTab(b.dataset.activate));
  $('[data-limit-settings]',page).onclick=()=>routeTo('settings');
  $('#playback-mode')?.addEventListener('change',async e=>{
    if(!current)return;
    current.playbackMode=e.target.value;
    destroyTabFrame(current.id);
    await saveActiveSession(false);
    renderSessionView();
  });
  $('[data-use-player]',page)?.addEventListener('click',async()=>{if(!current)return;current.playbackMode='auto';destroyTabFrame(current.id);await saveActiveSession(false);renderSessionView()});
  $('[data-use-webpage]',page)?.addEventListener('click',async()=>{if(!current)return;current.playbackMode='webpage';destroyTabFrame(current.id);await saveActiveSession(false);renderSessionView()});
  $$('[data-related]',page).forEach(b=>b.onclick=async()=>{
    const r=related[Number(b.dataset.related)];
    if(!r?.url)return;
    const local=backend.resolveUrl(r.url);const t={id:uid(),url:r.url,title:r.title||local.title||sourceFromUrl(r.url),thumbnail:r.thumbnail||'',embedUrl:r.embedUrl||local.embedUrl||'',mediaUrl:r.mediaUrl||local.mediaUrl||'',playbackMode:'auto',related:[],status:'suspended',pinned:false,lastActiveAt:0,tags:r.tags||local.tags||[],categoryIds:[]};
    S.activeSession.tabs.push(t);
    await saveActiveSession(false);
    await activateTab(t.id);
  });
}
function destroyTabFrame(id){
  const f=S.tabFrames.get(id);
  if(f){try{f.src='about:blank';f.remove()}catch{}S.tabFrames.delete(id)}
}
function mountVideo(url,tabId){
  const el=document.createElement('video');
  el.controls=true;
  el.preload=S.settings?.preloadVideos===false?'metadata':'auto';
  el.playsInline=true;
  el.dataset.tabId=tabId;
  el.src=url;
  return el;
}
function hydrateSessionFrames(){
  const s=S.activeSession,stage=$('#browser-stage');
  if(!s||!stage)return;
  for(const [id,el] of [...S.tabFrames]){
    const t=byId(s.tabs,id);
    if(!t||t.status!=='active'){destroyTabFrame(id)}
  }
  for(const t of s.tabs.filter(x=>x.status==='active')){
    if(!S.tabFrames.has(t.id)){
      const choice=playbackChoice(t);
      let el;
      if(choice.kind==='video'){
        el=mountVideo(choice.url,t.id);
      }else{
        el=document.createElement('iframe');
        el.allow='autoplay; fullscreen; picture-in-picture; encrypted-media';
        el.setAttribute('sandbox',frameSandbox(choice));
        el.referrerPolicy='strict-origin-when-cross-origin';
        el.src=choice.url||'about:blank';
      }
      el.dataset.tabId=t.id;
      el.style.display='none';
      S.tabFrames.set(t.id,el);
    }
  }
  stage.innerHTML='';
  for(const [id,el] of S.tabFrames){
    el.style.display=id===S.currentTabId?'block':'none';
    stage.append(el);
  }
  if(!S.currentTabId||!S.tabFrames.has(S.currentTabId)){
    stage.innerHTML=`<div class="browser-placeholder"><div><img src="./assets/nox-mark.svg" width="70" alt=""><h2>Tab suspended</h2><p>Activate this tab to preload it. Nox Vault keeps only ${S.settings.maxActiveTabs} active tabs mounted at once.</p></div></div>`;
  }
}
async function activateTab(id){
  const s=S.activeSession,t=byId(s?.tabs,id);
  if(!t)return;
  S.currentTabId=id;
  if(t.status!=='active'){
    const active=s.tabs.filter(x=>x.status==='active');
    if(active.length>=S.settings.maxActiveTabs){
      const candidates=active.filter(x=>!x.pinned&&x.id!==id).sort((a,b)=>(a.lastActiveAt||0)-(b.lastActiveAt||0));
      const victim=candidates[0]||active.find(x=>x.id!==id);
      if(victim){victim.status='suspended';destroyTabFrame(victim.id)}
    }
    t.status='active';
  }
  t.lastActiveAt=Date.now();
  await saveActiveSession(false);
  renderSessionView();
  queueAutoDetect(t);
}
async function suspendTab(id){
  const t=byId(S.activeSession?.tabs,id);if(!t)return;
  t.status='suspended';destroyTabFrame(id);
  if(S.currentTabId===id)S.currentTabId=S.activeSession.tabs.find(x=>x.status==='active')?.id||id;
  await saveActiveSession(false);renderSessionView();
}
async function suspendAllTabs(){for(const t of S.activeSession.tabs)t.status='suspended';unloadFrames();S.currentTabId=S.activeSession.tabs[0]?.id||null;await saveActiveSession(false);renderSessionView()}
async function closeTab(id){
  const s=S.activeSession;if(!s)return;
  const idx=s.tabs.findIndex(x=>x.id===id);if(idx<0)return;
  destroyTabFrame(id);s.tabs.splice(idx,1);
  if(S.currentTabId===id)S.currentTabId=s.tabs[Math.max(0,idx-1)]?.id||s.tabs[0]?.id||null;
  await saveActiveSession(false);renderSessionView();
}
function addTabModal(){modal(`<h2>Add Tab</h2><p>Enter a webpage URL. Supported sites such as xHamster and Pornhub are converted to their embed player locally, without a cross-origin fetch.</p><form class="form-grid"><label class="full">URL<input name="url" type="url" required placeholder="https://example.com/video"></label><label>Optional title<input name="title" placeholder="Auto from URL"></label><label>Optional embed URL<input name="embedUrl" type="url" placeholder="https://…/embed/…"></label><div class="form-actions full"><button class="btn primary">Add Tab</button></div></form>`,{onOpen:r=>r.querySelector('form').onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target));const local=backend.resolveUrl(d.url);const t={id:uid(),url:d.url,title:d.title||local.title||sourceFromUrl(d.url),embedUrl:d.embedUrl||local.embedUrl||'',mediaUrl:local.mediaUrl||((isDirectVideo(d.url)||isHls(d.url))?d.url:''),thumbnail:local.thumbnail||'',playbackMode:'auto',related:[],metadataCheckedAt:nowIso(),status:'suspended',pinned:false,lastActiveAt:0,tags:local.tags||[],categoryIds:[]};S.activeSession.tabs.push(t);r.remove();await activateTab(t.id)}})}

async function navigateCurrent(url){
  const t=byId(S.activeSession?.tabs,S.currentTabId);if(!t||!url)return;
  const local=backend.resolveUrl(url);
  t.url=url;t.mediaUrl=local.mediaUrl||((isDirectVideo(url)||isHls(url))?url:'');t.embedUrl=local.embedUrl||'';t.title=local.title||sourceFromUrl(url);t.thumbnail=local.thumbnail||'';
  t.tags=local.tags||[];t.related=[];t.metadataCheckedAt=nowIso();t.playbackMode='auto';t.status='active';t.lastActiveAt=Date.now();
  destroyTabFrame(t.id);await saveActiveSession(false);renderSessionView();
}
function reloadCurrent(){const f=S.tabFrames.get(S.currentTabId);if(f){if(f.tagName==='IFRAME')f.src=f.src;else{f.load();f.play().catch(()=>{})}}}
let metadataJobs=new Set();
function queueAutoDetect(tab){
  if(!tab?.url||S.settings?.autoDetectPlayback===false||tab.metadataCheckedAt||metadataJobs.has(tab.id))return;
  setTimeout(()=>metadataIntoTab(tab,false),80);
}
async function metadataIntoTab(tab,announce=true){
  if(!tab?.url||metadataJobs.has(tab.id))return;
  metadataJobs.add(tab.id);
  if(announce)toast('Resolving player, title and tags from the URL…');
  try{
    const m=await backend.fetchMetadata(tab.url);
    const before=`${tab.embedUrl}|${tab.mediaUrl}|${tab.thumbnail}|${tab.title}`;
    Object.assign(tab,{
      title:m.title||tab.title,thumbnail:m.thumbnail||tab.thumbnail,
      embedUrl:m.embedUrl||tab.embedUrl,mediaUrl:m.mediaUrl||tab.mediaUrl,
      related:Array.isArray(m.related)&&m.related.length?m.related:(tab.related||[]),
      tags:[...new Set([...(tab.tags||[]),...(m.tags||[])])].slice(0,30),
      metadataCheckedAt:nowIso()
    });
    await saveActiveSession(false);
    const after=`${tab.embedUrl}|${tab.mediaUrl}|${tab.thumbnail}|${tab.title}`;
    if(before!==after)destroyTabFrame(tab.id);
    if(S.currentTabId===tab.id)renderSessionView();
    if(announce)toast(tab.embedUrl||tab.mediaUrl?'Embedded/direct player resolved.':'No supported embed pattern found; using webpage mode.','success');
  }catch(err){
    tab.metadataCheckedAt=nowIso();
    await saveActiveSession(false).catch(()=>{});
    if(announce)toast(`Metadata: ${err.message}`,'error');
  }finally{metadataJobs.delete(tab.id)}
}

function categoryChecks(selected=[],suggested=[]){return S.categories.map(c=>`<label class="badge ${suggested.includes(c.name)?'green':'blue'}" style="cursor:pointer"><input type="checkbox" name="cat" value="${c.id}" ${selected.includes(c.id)||suggested.includes(c.name)?'checked':''}> ${esc(c.name)}</label>`).join('')}
async function saveItemModal(tabOrItem){const source=tabOrItem.url;const m=modal(`<h2>Save to Vault</h2><p>Nox Vault can suggest a title, tags and categories from public page metadata. You can edit everything before saving.</p><div class="notice" id="meta-status">Fetching metadata…</div><form id="save-item-form" class="form-grid" style="margin-top:12px"><label class="full">Title<input name="title" required value="${esc(tabOrItem.title||sourceFromUrl(source))}"></label><label class="full">URL<input name="url" type="url" required value="${esc(source)}"></label><label>Embed URL<input name="embedUrl" type="url" value="${esc(tabOrItem.embedUrl||'')}"></label><label>Direct media URL<input name="mediaUrl" type="url" value="${esc(tabOrItem.mediaUrl||'')}"></label><label>Playback mode<select name="playbackMode" class="select"><option value="auto" ${(tabOrItem.playbackMode||'auto')==='auto'?'selected':''}>Auto</option><option value="webpage" ${tabOrItem.playbackMode==='webpage'?'selected':''}>Full webpage</option><option value="embed" ${tabOrItem.playbackMode==='embed'?'selected':''}>Detected embed</option><option value="direct" ${tabOrItem.playbackMode==='direct'?'selected':''}>Direct media</option></select></label><div class="full"><span class="smalltext muted">Categories</span><div class="tag-cloud" id="category-checks" style="margin-top:7px">${categoryChecks(tabOrItem.categoryIds||tabOrItem.categories||[])}</div></div><label class="full">Tags<input name="tags" value="${esc((tabOrItem.tags||[]).join(', '))}" placeholder="tag 1, tag 2"></label><label class="full">Notes<textarea name="notes" rows="3">${esc(tabOrItem.notes||'')}</textarea></label><label><span>Favorite</span><input name="favorite" type="checkbox" ${tabOrItem.favorite?'checked':''}></label><label><span>Duplicate policy</span><select name="dup" class="select"><option value="skip">Skip if already saved</option><option value="update">Update existing item</option></select></label><div class="form-actions full"><button type="button" class="btn ghost" data-close>Cancel</button><button class="btn primary" type="submit">Save Item</button></div></form>`,{wide:true});m.querySelector('[data-close]').onclick=()=>m.remove();let meta=null;try{meta=await backend.fetchMetadata(source);const f=m.querySelector('form');if(meta.title)f.title.value=meta.title;if(meta.embedUrl&&!f.embedUrl.value)f.embedUrl.value=meta.embedUrl;if(meta.mediaUrl&&!f.mediaUrl.value)f.mediaUrl.value=meta.mediaUrl;f.tags.value=[...new Set([...parseTags(f.tags.value),...(meta.tags||[])])].join(', ');m.querySelector('#category-checks').innerHTML=categoryChecks(tabOrItem.categoryIds||tabOrItem.categories||[],meta.suggestedCategories||[]);m.querySelector('#meta-status').textContent=`Suggestions ready from ${meta.source||sourceFromUrl(source)}.`}catch(err){m.querySelector('#meta-status').textContent=`Metadata detection was unavailable: ${err.message}`}
  m.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;setBusy(b,true,'Saving…');try{const fd=new FormData(e.target),cats=[...e.target.querySelectorAll('input[name=cat]:checked')].map(x=>x.value);const d={title:fd.get('title'),url:fd.get('url'),embedUrl:fd.get('embedUrl'),mediaUrl:fd.get('mediaUrl'),categories:cats,tags:parseTags(fd.get('tags')),notes:fd.get('notes'),favorite:fd.get('favorite')==='on',thumbnail:meta?.thumbnail||tabOrItem.thumbnail||'',source:meta?.source||sourceFromUrl(fd.get('url')),playbackMode:fd.get('playbackMode')||'auto',related:meta?.related||tabOrItem.related||[]};const r=await backend.saveItem(S.currentVaultId,d,{skipIfExists:fd.get('dup')==='skip'});S.items=await backend.listItems(S.currentVaultId,true);m.remove();toast(r.status==='skipped'?'Already saved — skipped.':'Saved to library.','success')}catch(err){toast(err.message,'error')}finally{setBusy(b,false)}}}
function saveAllTabsModal(){
  if(!S.activeSession || !S.activeSession.tabs || !S.activeSession.tabs.length){
    toast('No tabs to save.');
    return;
  }

  const html=`<h2>Save All Session Tabs</h2>
    <p>Duplicates are skipped. Only new URLs are copied into the library.</p>
    <form class="form-grid">
      <label class="full">Category
        <select class="select" name="category">
          <option value="">No category</option>
          ${S.categories.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}
        </select>
      </label>
      <label class="full"><span>Metadata</span>
        <select class="select" name="metadata">
          <option value="yes">Detect title/tags for each tab</option>
          <option value="no">Use current tab titles only</option>
        </select>
      </label>
      <div class="form-actions full">
        <button class="btn primary" type="submit">Save ${S.activeSession.tabs.length} Tabs</button>
      </div>
    </form>`;

  modal(html,{
    onOpen:function(root){
      const form=root.querySelector('form');
      form.onsubmit=async function(e){
        e.preventDefault();
        const button=e.submitter;
        const fd=new FormData(e.target);
        const categoryId=fd.get('category');
        setBusy(button,true,'Saving…');

        let saved=0;
        let skipped=0;
        let failed=0;

        try{
          for(const tab of S.activeSession.tabs){
            try{
              let meta={};
              if(fd.get('metadata')==='yes'){
                try{
                  meta=await backend.fetchMetadata(tab.url);
                }catch(metaError){
                  console.warn('Metadata lookup failed for',tab.url,metaError);
                }
              }

              const result=await backend.saveItem(
                S.currentVaultId,
                {
                  title:meta.title||tab.title||sourceFromUrl(tab.url),
                  url:tab.url,
                  embedUrl:meta.embedUrl||tab.embedUrl||'',
                  mediaUrl:meta.mediaUrl||tab.mediaUrl||'',
                  thumbnail:meta.thumbnail||tab.thumbnail||'',
                  source:meta.source||sourceFromUrl(tab.url),
                  categories:categoryId?[categoryId]:[],
                  tags:[...new Set([...(tab.tags||[]),...(meta.tags||[])])],
                  playbackMode:tab.playbackMode||'auto',
                  related:meta.related||tab.related||[]
                },
                {skipIfExists:true}
              );

              if(result.status==='skipped') skipped+=1;
              else saved+=1;
            }catch(saveError){
              console.error('Could not save tab',tab.url,saveError);
              failed+=1;
            }
          }

          S.items=await backend.listItems(S.currentVaultId,true);
          root.remove();
          toast(
            `${saved} saved · ${skipped} skipped · ${failed} failed`,
            failed?'':'success'
          );
        }catch(err){
          console.error(err);
          toast(err.message||'Could not save session tabs.','error');
        }finally{
          setBusy(button,false);
        }
      };
    }
  });
}

function renderLibrary(){const q=S.search.trim().toLowerCase(),items=activeItems().filter(i=>!q||[i.title,i.url,i.source,...(i.tags||[]),...itemCategories(i)].join(' ').toLowerCase().includes(q));page.innerHTML=`${pageHeader('Library','All saved links, videos and references in the current vault.','<button class="btn primary" data-add-link>＋ Save Link</button>')}
  <div class="filters"><input id="library-search" type="text" placeholder="Search saved items…" value="${esc(S.search)}"><select id="lib-category" class="select"><option value="">All Categories</option>${S.categories.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select><select id="lib-filter" class="select"><option value="all">All Items</option><option value="favorites">Favorites</option><option value="never">Never Viewed</option><option value="recent">Recently Viewed</option></select><button class="btn ghost" data-random>Random</button></div>
  <div id="library-grid" class="content-grid">${items.length?items.map(mediaCard).join(''):`<div class="empty" style="grid-column:1/-1"><div><strong>No matching items</strong>Save a link from a session or use “Save Link”.</div></div>`}</div>`;
  const search=$('#library-search');search.oninput=()=>{S.search=search.value;renderLibrary()};$('#lib-category').onchange=e=>filterLibraryDom({category:e.target.value,mode:$('#lib-filter').value});$('#lib-filter').onchange=e=>filterLibraryDom({category:$('#lib-category').value,mode:e.target.value});$('[data-add-link]',page).onclick=()=>saveLinkPrompt();$('[data-random]',page).onclick=()=>{const arr=activeItems();if(arr.length)showItemDetail(arr[Math.floor(Math.random()*arr.length)].id)};wireMediaCards();}
function mediaCard(i){return `<article class="media-card" data-item-card="${i.id}" data-cats="${esc((i.categories||[]).join(','))}" data-fav="${i.favorite?'1':'0'}" data-viewed="${i.lastViewedAt?'1':'0'}"><button class="star ${i.favorite?'on':''}" data-star="${i.id}">${i.favorite?'★':'☆'}</button>${thumb(i)}<div class="media-body"><h3>${esc(i.title)}</h3><p>${esc(i.source||'link')} · ${(i.tags||[]).slice(0,3).map(esc).join(' · ')}</p><div class="media-meta"><span>${i.viewCount||0} views · ${timeAgo(i.lastViewedAt||i.createdAt)}</span><button class="btn small ghost" data-item-menu="${i.id}">•••</button></div></div></article>`}
function wireMediaCards(){$$('[data-item-card]',page).forEach(c=>c.onclick=e=>{if(e.target.closest('button'))return;showItemDetail(c.dataset.itemCard)});$$('[data-star]',page).forEach(b=>b.onclick=async e=>{e.stopPropagation();const i=byId(S.items,b.dataset.star);await backend.updateItem(S.currentVaultId,i.id,{favorite:!i.favorite});i.favorite=!i.favorite;renderLibrary()});$$('[data-item-menu]',page).forEach(b=>b.onclick=e=>{e.stopPropagation();const id=b.dataset.itemMenu;openContext(e,[['Open in new session',()=>openItemInSession(id)],['Add to Player',()=>{S.playerQueue=[byId(S.items,id)];S.playerIndex=0;routeTo('player')}],['Edit / details',()=>showItemDetail(id)],['Move to Trash',()=>trashItem(id)]])})}
function filterLibraryDom({category,mode}){$$('[data-item-card]',page).forEach(c=>{let ok=!category||c.dataset.cats.split(',').includes(category);if(mode==='favorites')ok&&=c.dataset.fav==='1';if(mode==='never')ok&&=c.dataset.viewed==='0';c.style.display=ok?'':'none'})}
function saveLinkPrompt(){modal(`<h2>Save Link</h2><form><input name="url" type="url" required placeholder="https://example.com/video"><div class="form-actions"><button class="btn primary">Continue</button></div></form>`,{onOpen:r=>r.querySelector('form').onsubmit=e=>{e.preventDefault();const u=e.target.url.value;r.remove();saveItemModal({url:u,title:sourceFromUrl(u),tags:[],categoryIds:[]})}})}
async function openItemInSession(id){const i=byId(S.items,id);if(!i)return;const s=await backend.saveSession(S.currentVaultId,{name:i.title,tabs:[{id:uid(),url:i.url,title:i.title,embedUrl:i.embedUrl||'',mediaUrl:i.mediaUrl||'',thumbnail:i.thumbnail||'',tags:i.tags||[],playbackMode:i.playbackMode||'auto',related:i.related||[],status:'active',pinned:false,lastActiveAt:Date.now()}],categoryIds:i.categories||[]});S.sessions=await backend.listSessions(S.currentVaultId);openSessionById(s.id)}
async function trashItem(id){await backend.trashItem(S.currentVaultId,id);S.items=await backend.listItems(S.currentVaultId,true);toast('Moved to Trash.','success');renderLibrary()}
function showItemDetail(id){const i=byId(S.items,id);if(!i)return;modal(`<h2>${esc(i.title)}</h2><p>${esc(i.source||'Saved item')}</p><div class="save-preview"><div>${thumb(i)}</div><div class="stack"><div><span class="smalltext muted">URL</span><div class="mono smalltext">${esc(i.url)}</div></div><div class="tag-cloud">${itemCategories(i).map(x=>badge(x,'purple')).join('')}${(i.tags||[]).map(x=>badge(x,'blue')).join('')}</div><label>Notes<textarea id="detail-notes" rows="4">${esc(i.notes||'')}</textarea></label><div class="spaced"><span class="muted smalltext">Viewed ${i.viewCount||0} times · ${timeAgo(i.lastViewedAt)}</span><span><button class="btn small ghost" data-detail-session>Open in Session</button> <button class="btn small primary" data-detail-player>Play</button></span></div></div></div>`,{wide:true,onOpen:r=>{r.querySelector('#detail-notes').onchange=async e=>{await backend.updateItem(S.currentVaultId,id,{notes:e.target.value});i.notes=e.target.value};r.querySelector('[data-detail-session]').onclick=()=>{r.remove();openItemInSession(id)};r.querySelector('[data-detail-player]').onclick=()=>{r.remove();S.playerQueue=[i];S.playerIndex=0;routeTo('player')}}})}
function renderCategories(){page.innerHTML=`${pageHeader('Categories','Organise saved links and sessions with practical categories.','<button class="btn primary" data-new-category>＋ New Category</button>')}<div class="category-grid">${S.categories.map(c=>{const count=activeItems().filter(i=>(i.categories||[]).includes(c.id)).length;return `<article class="card category-card"><div class="folder" style="filter:hue-rotate(${Math.floor(Math.random()*120)}deg)"></div><h3>${esc(c.name)}</h3><p>${count} saved items</p><div style="margin-top:10px"><button class="btn small ghost" data-cat-open="${c.id}">View</button> <button class="btn small ghost" data-cat-menu="${c.id}">•••</button></div></article>`}).join('')}</div>`;$('[data-new-category]',page).onclick=()=>categoryModal();$$('[data-cat-open]',page).forEach(b=>b.onclick=()=>{S.search=catName(b.dataset.catOpen);routeTo('library')});$$('[data-cat-menu]',page).forEach(b=>b.onclick=e=>openContext(e,[['Edit',()=>categoryModal(b.dataset.catMenu)],['Delete',async()=>{if(await confirmModal('Delete category?','Saved items remain, but this category will be removed.','Delete')){await backend.deleteCategory(S.currentVaultId,b.dataset.catMenu);S.categories=await backend.listCategories(S.currentVaultId);renderCategories()}}]]))}
function categoryModal(id=null){const c=id?currentCat(id):null;modal(`<h2>${c?'Edit':'New'} Category</h2><form class="form-grid"><label>Category name<input name="name" required value="${esc(c?.name||'')}"></label><label>Colour<input type="color" name="color" value="${esc(c?.color||'#3377ff')}"></label><div class="form-actions full"><button class="btn primary">Save</button></div></form>`,{onOpen:r=>r.querySelector('form').onsubmit=async e=>{e.preventDefault();await backend.saveCategory(S.currentVaultId,{id,...Object.fromEntries(new FormData(e.target))});S.categories=await backend.listCategories(S.currentVaultId);r.remove();renderCategories();toast('Category saved.','success')}})}
function renderNotes(type='note'){const rows=sortBy(S.notes.filter(n=>n.type===type),'updatedAt');const title=type==='journal'?'Journal':'Notes',sub=type==='journal'?'Private diary entries and linked memories.':'Quick notes, references and linked items.';page.innerHTML=`${pageHeader(title,sub,`<button class="btn primary" data-new-note>＋ New ${type==='journal'?'Entry':'Note'}</button>`)}<div class="timeline">${rows.length?rows.map(n=>`<div class="timeline-item"><div class="timeline-date">${fmtDate(n.updatedAt,true)}</div><div class="timeline-rail"></div><div class="timeline-content"><h3>${esc(n.title)}</h3><p>${esc(n.body)}</p><div class="tag-cloud">${(n.tags||[]).map(t=>badge(t,'blue')).join('')}</div><div style="margin-top:8px"><button class="btn small ghost" data-edit-note="${n.id}">Edit</button> <button class="btn small ghost" data-delete-note="${n.id}">Delete</button></div></div></div>`).join(''):`<div class="empty"><div><strong>No ${title.toLowerCase()} yet</strong>Create your first entry.</div></div>`}</div>`;$('[data-new-note]',page).onclick=()=>noteModal(type);$$('[data-edit-note]',page).forEach(b=>b.onclick=()=>noteModal(type,byId(S.notes,b.dataset.editNote)));$$('[data-delete-note]',page).forEach(b=>b.onclick=async()=>{if(await confirmModal('Delete this note?','This cannot be undone.','Delete')){await backend.deleteNote(S.currentVaultId,b.dataset.deleteNote);S.notes=await backend.listNotes(S.currentVaultId);renderNotes(type)}})}
function noteModal(type='note',existing=null){modal(`<h2>${existing?'Edit':'New'} ${type==='journal'?'Journal Entry':'Note'}</h2><form class="form-grid"><label class="full">Title<input name="title" required value="${esc(existing?.title||'')}"></label><label class="full">Text<textarea name="body" rows="8">${esc(existing?.body||'')}</textarea></label><label class="full">Tags<input name="tags" value="${esc((existing?.tags||[]).join(', '))}" placeholder="private, idea, later"></label><div class="form-actions full"><button class="btn primary">Save</button></div></form>`,{onOpen:r=>r.querySelector('form').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target);await backend.saveNote(S.currentVaultId,{id:existing?.id,type,title:fd.get('title'),body:fd.get('body'),tags:parseTags(fd.get('tags')),createdAt:existing?.createdAt});S.notes=await backend.listNotes(S.currentVaultId);r.remove();renderNotes(type);toast('Saved.','success')}})}
function renderImages(){page.innerHTML=`${pageHeader('Images','Store photos, screenshots and imported images in the current vault. Images are compressed and stored as Firestore chunks, so Firebase Storage is not required.','<button class="btn primary" data-add-image>＋ Add Image</button>')}<div class="filters"><button class="btn ghost" data-camera>📷 Take Photo</button><button class="btn ghost" data-upload>⇧ Upload</button><button class="btn ghost" data-url-image>🔗 Save Image URL</button><span class="muted smalltext">You can also paste an image from the clipboard on this page.</span></div><div class="image-grid">${S.images.length?sortBy(S.images,'createdAt').map(i=>`<div class="image-card" title="${esc(i.caption||i.name)}" data-image-open="${i.id}">${i.thumbnailDataUrl||i.url?`<img src="${esc(i.thumbnailDataUrl||i.url)}" alt="${esc(i.caption||i.name||'Image')}" loading="lazy">`:'<div class="image-placeholder"></div>'}<div class="image-actions"><button class="btn icon small" data-image-delete="${i.id}" title="Delete">⌫</button></div></div>`).join(''):`<div class="empty" style="grid-column:1/-1"><div><strong>No images yet</strong>Take a photo on your tablet, upload a file, paste an image, or import an image URL.</div></div>`}</div>`;$('[data-add-image]',page).onclick=imageAddModal;$('[data-camera]',page).onclick=()=>captureOrUpload(true);$('[data-upload]',page).onclick=()=>captureOrUpload(false);$('[data-url-image]',page).onclick=remoteImageModal;$$('[data-image-open]',page).forEach(card=>card.onclick=e=>{if(e.target.closest('[data-image-delete]'))return;openStoredImage(card.dataset.imageOpen)});$$('[data-image-delete]',page).forEach(b=>b.onclick=async e=>{e.stopPropagation();const img=byId(S.images,b.dataset.imageDelete);if(await confirmModal('Delete image?','This removes the stored image from Nox Vault.','Delete')){await backend.deleteImage(S.currentVaultId,img);S.images=await backend.listImages(S.currentVaultId);renderImages()}})}
async function openStoredImage(id){const img=byId(S.images,id);if(!img)return;const m=modal(`<h2>${esc(img.caption||img.name||'Image')}</h2><div class="notice">Loading stored image…</div><div class="image-viewer" style="margin-top:12px;text-align:center"></div>`,{wide:true});try{const url=await backend.getImageUrl(S.currentVaultId,img);const box=m.querySelector('.image-viewer');m.querySelector('.notice').remove();box.innerHTML=`<img src="${esc(url)}" alt="${esc(img.caption||img.name||'Image')}" style="max-width:100%;max-height:70vh;border-radius:12px">`}catch(err){m.querySelector('.notice').textContent=err.message}}
function imageAddModal(){modal(`<h2>Add Image</h2><p>Nox Vault compresses the image in your browser, then stores the actual image bytes in Firestore chunk documents. Firebase Storage and Cloud Functions are not required.</p><div class="quick-grid"><button class="quick" data-camera><strong>📷 Take Photo</strong><small>Use tablet / phone camera</small></button><button class="quick" data-upload><strong>⇧ Upload File</strong><small>Choose an image</small></button><button class="quick" data-url><strong>🔗 Save Image URL</strong><small>Works when the image host permits browser downloads</small></button><button class="quick" data-paste><strong>⌘ Paste Image</strong><small>Use clipboard if supported</small></button></div>`,{onOpen:r=>{r.querySelector('[data-camera]').onclick=()=>{r.remove();captureOrUpload(true)};r.querySelector('[data-upload]').onclick=()=>{r.remove();captureOrUpload(false)};r.querySelector('[data-url]').onclick=()=>{r.remove();remoteImageModal()};r.querySelector('[data-paste]').onclick=async()=>{try{const items=await navigator.clipboard.read();for(const x of items){const type=x.types.find(t=>t.startsWith('image/'));if(type){const blob=await x.getType(type);const file=new File([blob],`pasted-${Date.now()}.${type.split('/')[1]||'png'}`,{type});await uploadImageFile(file);r.remove();return}}toast('No image found in clipboard.','error')}catch(err){toast(`Clipboard access failed: ${err.message}`,'error')}}}})}
async function captureOrUpload(camera){const f=await pickFile({accept:'image/*',capture:camera});if(f)await uploadImageFile(f)}
async function uploadImageFile(file){toast('Compressing and saving image…');try{const img=await backend.uploadImage(S.currentVaultId,file);S.images.push(img);toast('Image stored in Firestore.','success');if(parseRoute().name==='images')renderImages()}catch(err){toast(err.message,'error')}}
function remoteImageModal(){modal(`<h2>Save Image URL</h2><p>Nox Vault will try to download the image directly in your browser, compress it, and save the actual bytes in Firestore. Some websites block this with CORS; if that happens, use copy/paste or download the image and use Upload.</p><form><input name="url" type="url" required placeholder="https://example.com/image.jpg"><div class="form-actions"><button class="btn primary">Import Image</button></div></form>`,{onOpen:r=>r.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=e.submitter;setBusy(b,true,'Importing…');try{await backend.importRemoteImage(S.currentVaultId,e.target.url.value);S.images=await backend.listImages(S.currentVaultId);r.remove();renderImages();toast('Remote image copied into Firestore.','success')}catch(err){toast(err.message,'error')}finally{setBusy(b,false)}}})}

function buildPlayerQueue(mode,value){let q=[];if(mode==='vault')q=activeItems();if(mode==='favorites')q=activeItems().filter(i=>i.favorite);if(mode==='category')q=activeItems().filter(i=>(i.categories||[]).includes(value));if(mode==='session'){const s=byId(S.sessions,value);q=(s?.tabs||[]).map(t=>({id:`tab-${t.id}`,title:t.title,url:t.url,embedUrl:t.embedUrl,mediaUrl:t.mediaUrl,thumbnail:t.thumbnail,playbackMode:t.playbackMode||'auto',related:t.related||[],tags:t.tags||[],source:sourceFromUrl(t.url)}))}if(S.playerMode==='shuffle')q=randomSubset(q);S.playerQueue=q;S.playerIndex=0}
function renderPlayer(){
  if(!S.playerQueue.length) buildPlayerQueue('vault');
  const item=S.playerQueue[S.playerIndex];
  const shuffleText=S.playerMode==='shuffle'?'Shuffle: On':'Shuffle: Off';
  const headerActions=`<button class="btn ghost" data-shuffle>${shuffleText}</button>`;

  page.innerHTML=`${pageHeader(
    'Player',
    'Play saved content from a session, category, favorites, or your entire vault.',
    headerActions
  )}
  <div class="player-layout">
    <aside class="card player-source">
      <h3 style="margin:0 0 4px">Play from</h3>
      <button class="btn ${!item?'primary':'ghost'}" data-source="vault">Entire Vault</button>
      <button class="btn ghost" data-source="favorites">Favorites</button>
      <select id="player-category" class="select">
        <option value="">Category…</option>
        ${S.categories.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}
      </select>
      <select id="player-session" class="select">
        <option value="">Session…</option>
        ${S.sessions.map(session=>`<option value="${session.id}">${esc(session.name)}</option>`).join('')}
      </select>
      <div class="hr"></div>
      <p class="muted smalltext">Auto-next works for direct HTML5 video links. Cross-origin embedded players usually cannot report “ended” back to Nox Vault, so Next remains available manually.</p>
    </aside>

    <section class="card player-main">
      <div class="player-screen" id="player-screen">${playerStage(item)}</div>
      <div class="player-controls">
        <button class="btn icon" data-prev>⏮</button>
        <button class="big-play" data-main-play>▶</button>
        <button class="btn icon" data-next>⏭</button>
        <span class="muted smalltext">${item?`${S.playerIndex+1} / ${S.playerQueue.length} · ${esc(item.title)}`:'No playable items'}</span>
        <span style="flex:1"></span>
        <button class="btn small ghost" data-random>Random</button>
      </div>
    </section>

    <aside class="card playlist">
      <h3 style="margin:0 0 10px">Playlist</h3>
      ${S.playerQueue.length
        ? S.playerQueue.map((entry,index)=>`<button class="playlist-row ${index===S.playerIndex?'current':''}" data-play-index="${index}"><span>${index+1}</span>${thumb(entry,'mini-thumb')}<div><b>${esc(entry.title)}</b><small>${esc(entry.source||sourceFromUrl(entry.url))}</small></div></button>`).join('')
        : '<div class="empty"><div><strong>Nothing to play</strong>Save some items first.</div></div>'}
    </aside>
  </div>`;

  hydratePlayer(item);
  $$('[data-source]',page).forEach(button=>{
    button.onclick=()=>{
      buildPlayerQueue(button.dataset.source);
      renderPlayer();
    };
  });
  $('#player-category').onchange=event=>{
    if(event.target.value){
      buildPlayerQueue('category',event.target.value);
      renderPlayer();
    }
  };
  $('#player-session').onchange=event=>{
    if(event.target.value){
      buildPlayerQueue('session',event.target.value);
      renderPlayer();
    }
  };
  $('[data-shuffle]',page).onclick=()=>{
    S.playerMode=S.playerMode==='shuffle'?'order':'shuffle';
    S.playerQueue=S.playerMode==='shuffle'?randomSubset(S.playerQueue):S.playerQueue;
    S.playerIndex=0;
    renderPlayer();
  };
  $('[data-prev]',page).onclick=()=>playerMove(-1);
  $('[data-next]',page).onclick=()=>playerMove(1);
  $('[data-random]',page).onclick=()=>{
    if(S.playerQueue.length){
      S.playerIndex=Math.floor(Math.random()*S.playerQueue.length);
      renderPlayer();
    }
  };
  $$('[data-play-index]',page).forEach(button=>{
    button.onclick=()=>{
      S.playerIndex=Number(button.dataset.playIndex);
      renderPlayer();
    };
  });
  $('[data-main-play]',page).onclick=()=>{
    const video=$('#player-screen video');
    if(video) video.paused?video.play().catch(()=>{}):video.pause();
  };
}
function playerStage(i){
  if(!i)return `<div class="browser-placeholder"><div><img src="./assets/nox-mark.svg" width="70"><h2>No item selected</h2><p>Choose a source on the left.</p></div></div>`;
  const choice=playbackChoice(i);
  if(choice.kind==='video')return `<video id="playlist-video" controls playsinline preload="auto" src="${esc(choice.url)}"></video>`;
  return `<iframe id="playlist-frame" src="${esc(choice.url)}" allow="autoplay; fullscreen; picture-in-picture; encrypted-media" sandbox="${frameSandbox(choice)}" referrerpolicy="strict-origin-when-cross-origin"></iframe>`;
}
function hydratePlayer(item){if(!item)return;backend.markViewed(S.currentVaultId,item.id).catch(()=>{});const v=$('#playlist-video');if(v){v.onended=()=>{if(S.settings.playerAutoplay)playerMove(1)};if(S.settings.playerAutoplay)v.play().catch(()=>{})}}
function playerMove(delta){if(!S.playerQueue.length)return;S.playerIndex=(S.playerIndex+delta+S.playerQueue.length)%S.playerQueue.length;renderPlayer()}
function renderTrash(){const rows=S.items.filter(i=>i.deletedAt);page.innerHTML=`${pageHeader('Trash','Restore saved items or permanently delete them.')}<div class="content-grid">${rows.length?rows.map(i=>`<article class="media-card"><div class="thumb"></div><div class="media-body"><h3>${esc(i.title)}</h3><p>Deleted ${timeAgo(i.deletedAt)}</p><div class="media-meta"><button class="btn small ghost" data-restore="${i.id}">Restore</button><button class="btn small danger" data-delete-forever="${i.id}">Delete Forever</button></div></div></article>`).join(''):`<div class="empty" style="grid-column:1/-1"><div><strong>Trash is empty</strong>Deleted library items appear here.</div></div>`}</div>`;$$('[data-restore]',page).forEach(b=>b.onclick=async()=>{await backend.restoreItem(S.currentVaultId,b.dataset.restore);S.items=await backend.listItems(S.currentVaultId,true);renderTrash()});$$('[data-delete-forever]',page).forEach(b=>b.onclick=async()=>{if(await confirmModal('Delete forever?','This cannot be undone.','Delete Forever')){await backend.deleteItemForever(S.currentVaultId,b.dataset.deleteForever);S.items=await backend.listItems(S.currentVaultId,true);renderTrash()}})}
function decoyRowsHtml(){
  const rows=[...(S.settings.decoySections||[])];
  while(rows.length<5)rows.push({name:`Section ${rows.length+1}`,url:''});
  return rows.slice(0,5).map((row,i)=>`<div class="decoy-config-row"><span>${i+1}</span><input name="decoyName${i}" value="${esc(row.name||`Section ${i+1}`)}" maxlength="30" placeholder="Section name"><input name="decoyUrl${i}" type="url" value="${esc(row.url||'')}" placeholder="https://example.com/"></div>`).join('');
}
function renderSettings(){
  const sections=[...(S.settings.decoySections||[])];while(sections.length<5)sections.push({name:`Section ${sections.length+1}`,url:''});
  page.innerHTML=`${pageHeader('Settings','Control sessions, playback detection, decoy pages, privacy and backups.')}
  <div class="settings-grid">
    <section class="card setting-group"><h3>Sessions & Memory</h3>
      <div class="setting-row"><div><strong>Maximum active tabs</strong><p>Only this many tabs keep an iframe/player mounted.</p></div><select id="set-active-limit" class="select">${[1,2,3,4,5].map(n=>`<option value="${n}" ${n===Number(S.settings.maxActiveTabs)?'selected':''}>${n}</option>`).join('')}</select></div>
      <div class="setting-row"><div><strong>Session autosave</strong><p>Save tab changes as you browse.</p></div><input id="set-autosave" class="toggle" type="checkbox" ${S.settings.sessionAutosave?'checked':''}></div>
      <div class="setting-row"><div><strong>Preload active videos</strong><p>Active direct-video tabs can preload while suspended tabs stay unloaded.</p></div><input id="set-preload" class="toggle" type="checkbox" ${S.settings.preloadVideos?'checked':''}></div>
    </section>
    <section class="card setting-group"><h3>Playback Detection</h3>
      <div class="setting-row"><div><strong>Auto-detect embedded player</strong><p>When a tab opens, resolve supported embed/direct-player URLs locally without cross-origin page fetches.</p></div><input id="set-auto-detect" class="toggle" type="checkbox" ${S.settings.autoDetectPlayback!==false?'checked':''}></div>
      <div class="setting-row"><div><strong>Prefer detected player</strong><p>Auto mode uses an embed/direct player before falling back to the full webpage.</p></div><input id="set-prefer-player" class="toggle" type="checkbox" ${S.settings.preferDetectedPlayer!==false?'checked':''}></div>
      <div class="setting-row"><div><strong>Auto-next direct videos</strong><p>Advance after a directly playable HTML5 video ends.</p></div><input id="set-player-auto" class="toggle" type="checkbox" ${S.settings.playerAutoplay?'checked':''}></div>
      <div class="setting-row"><div><strong>Default shuffle</strong><p>Start player queues shuffled.</p></div><input id="set-shuffle" class="toggle" type="checkbox" ${S.settings.playerShuffle?'checked':''}></div>
    </section>
    <section class="card setting-group"><h3>Privacy</h3>
      <div class="setting-row"><div><strong>Auto-lock after inactivity</strong><p>Locks the active vault and unloads active frames.</p></div><select id="set-inactivity" class="select">${[1,5,10,15,30,60].map(n=>`<option value="${n}" ${n===Number(S.settings.inactivityMinutes)?'selected':''}>${n} min</option>`).join('')}</select></div>
      <div class="setting-row"><div><strong>Show decoy when locking</strong><p>Switch to the configured decoy shell on lock.</p></div><input id="set-decoy-lock" class="toggle" type="checkbox" ${S.settings.decoyOnLock?'checked':''}></div>
      <div class="setting-row"><div><strong>Panic shortcut</strong><p>Immediately unload Nox content and open the decoy.</p></div><button id="capture-shortcut" class="btn ghost">${prettyShortcut(S.settings.panicShortcut)}</button></div>
      <p class="muted smalltext">Saved thumbnails are intentionally shown normally in v1.1.</p>
    </section>
    <section class="card setting-group decoy-settings"><h3>Decoy Sections</h3>
      <p class="muted smalltext">Configure up to five neutral websites. Each opens inside the decoy iframe when the destination allows iframe embedding.</p>
      <form id="decoy-settings-form">
        <div class="decoy-config-head"><span>#</span><span>Button name</span><span>Page URL</span></div>
        ${decoyRowsHtml()}
        <div class="setting-row"><div><strong>Default section</strong><p>The Home button and initial decoy view use this section.</p></div><select name="decoyDefaultIndex" class="select">${sections.slice(0,5).map((x,i)=>`<option value="${i}" ${Number(S.settings.decoyDefaultIndex||0)===i?'selected':''}>${esc(x.name||`Section ${i+1}`)}</option>`).join('')}</select></div>
        <div class="form-actions"><button class="btn primary" type="submit">Save Decoy Layout</button></div>
      </form>
    </section>
    <section class="card setting-group"><h3>Backup & Restore</h3><p class="muted smalltext">Exports metadata, notes, sessions and image records as JSON. Firestore image chunk binaries are not embedded in the JSON export.</p><div class="quick-grid"><button class="quick" data-export><strong>⇩ Export Vault</strong><small>Download JSON backup</small></button><button class="quick" data-import><strong>⇧ Import JSON</strong><small>Merge data into current vault</small></button></div></section>
    <section class="card setting-group danger-zone"><h3>Vault Security</h3><p class="muted smalltext">Vault passwords are PBKDF2 hashes in your owner-only Firestore data. They are application locks, not encryption.</p><div class="quick-grid"><button class="quick" data-change-pass><strong>🔑 Change Vault Password</strong><small>Current vault</small></button><button class="quick" data-lock-now><strong>🔒 Lock Now</strong><small>Unload active content</small></button></div></section>
  </div>`;
  const save=async p=>{S.settings={...S.settings,...p};await backend.saveSettings(p);applySettings();resetIdle()};
  $('#set-active-limit').onchange=e=>updateActiveLimit(Number(e.target.value));
  $('#set-autosave').onchange=e=>save({sessionAutosave:e.target.checked});
  $('#set-preload').onchange=e=>save({preloadVideos:e.target.checked});
  $('#set-inactivity').onchange=e=>save({inactivityMinutes:Number(e.target.value)});
  $('#set-decoy-lock').onchange=e=>save({decoyOnLock:e.target.checked});
  $('#set-auto-detect').onchange=e=>save({autoDetectPlayback:e.target.checked});
  $('#set-prefer-player').onchange=e=>save({preferDetectedPlayer:e.target.checked});
  $('#set-player-auto').onchange=e=>save({playerAutoplay:e.target.checked});
  $('#set-shuffle').onchange=e=>save({playerShuffle:e.target.checked});
  $('[data-export]',page).onclick=exportCurrentVault;
  $('[data-import]',page).onclick=importVaultJson;
  $('[data-change-pass]',page).onclick=()=>changeVaultPasswordModal(S.currentVaultId);
  $('[data-lock-now]',page).onclick=()=>lockVault(S.currentVaultId,{decoy:false});
  $('#capture-shortcut').onclick=captureShortcut;
  $('#decoy-settings-form').onsubmit=async e=>{
    e.preventDefault();
    const fd=new FormData(e.target),decoySections=[];
    for(let i=0;i<5;i++)decoySections.push({name:String(fd.get(`decoyName${i}`)||`Section ${i+1}`).trim(),url:String(fd.get(`decoyUrl${i}`)||'').trim()});
    const decoyDefaultIndex=Math.min(4,Math.max(0,Number(fd.get('decoyDefaultIndex')||0)));
    await save({decoySections,decoyDefaultIndex});
    toast('Decoy layout saved.','success');
    renderSettings();
  };
}
async function updateActiveLimit(n){S.settings.maxActiveTabs=n;await backend.saveSettings({maxActiveTabs:n});activeLimitTop.value=String(n);if(S.activeSession){const active=S.activeSession.tabs.filter(t=>t.status==='active');if(active.length>n){active.filter(t=>!t.pinned).sort((a,b)=>(a.lastActiveAt||0)-(b.lastActiveAt||0)).slice(0,active.length-n).forEach(t=>t.status='suspended');await saveActiveSession(false);hydrateSessionFrames()}}toast(`Active-tab limit set to ${n}.`,'success')}
function captureShortcut(){const b=$('#capture-shortcut');b.textContent='Press shortcut…';const handler=async e=>{e.preventDefault();if(!e.ctrlKey&&!e.altKey&&!e.metaKey) return;const parts=[];if(e.ctrlKey)parts.push('Ctrl');if(e.altKey)parts.push('Alt');if(e.shiftKey)parts.push('Shift');if(e.metaKey)parts.push('Meta');parts.push(e.code==='Space'?'Space':e.key.length===1?e.key.toUpperCase():e.key);const s=parts.join('+');S.settings.panicShortcut=s;await backend.saveSettings({panicShortcut:s});applySettings();b.textContent=prettyShortcut(s);removeEventListener('keydown',handler,true);toast('Panic shortcut updated.','success')};addEventListener('keydown',handler,true)}
async function exportCurrentVault(){const data=await backend.exportVault(S.currentVaultId);downloadBlob(`nox-vault-${(currentVault()?.name||'vault').replace(/[^a-z0-9]+/gi,'-').toLowerCase()}-${new Date().toISOString().slice(0,10)}.json`,new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));toast('Vault export created.','success')}
async function importVaultJson(){const file=await pickFile({accept:'application/json,.json'});if(!file)return;try{const data=JSON.parse(await file.text());await backend.importVaultData(S.currentVaultId,data);await loadVaultData();toast('Backup merged into current vault.','success');renderSettings()}catch(err){toast(`Import failed: ${err.message}`,'error')}}
function renderPrivacy(){
  const sections=(S.settings.decoySections||[]).filter(x=>x?.name);
  page.innerHTML=`${pageHeader('Privacy & Decoy','Instantly hide Nox Vault, lock vaults and control the configurable decoy shell.')}
  <div class="settings-grid">
    <section class="card setting-group"><h3>Panic Hide</h3><div class="notice">Current shortcut: <b>${prettyShortcut(S.settings.panicShortcut)}</b>.</div><div style="height:12px"></div><button class="btn danger wide" data-panic-now>◉̸ Test Panic Hide</button><p class="muted smalltext">Panic Hide unloads mounted tab/player content before navigating to the decoy.</p></section>
    <section class="card setting-group"><h3>Automatic Lock</h3><div class="status-list"><div class="status-line"><span>Idle timeout</span><b>${S.settings.inactivityMinutes} minutes</b></div><div class="status-line"><span>Decoy on lock</span><b>${S.settings.decoyOnLock?'Yes':'No'}</b></div><div class="status-line"><span>Active frames unloaded</span><b>Yes</b></div><div class="status-line"><span>Vault passwords</span><b>PBKDF2 hashed</b></div></div><div style="height:12px"></div><button class="btn outline wide" data-lock-all>Lock All Vaults</button></section>
    <section class="card setting-group"><h3>Decoy Shell</h3><p class="muted smalltext">${sections.length} configured section buttons. The decoy uses the Nox-style sidebar, a Home button, custom iframe pages, and a password-protected Settings/Unlock action.</p><div class="tag-cloud">${sections.map(x=>badge(x.name,'blue')).join('')}</div><div style="height:12px"></div><button class="btn ghost" data-open-decoy>Open Decoy Page</button> <button class="btn ghost" data-decoy-settings>Configure</button></section>
    <section class="card setting-group"><h3>Embedding limits</h3><p class="muted smalltext">Nox uses supported embed URLs first and can also show the original page in the main session iframe. Sites may still block full-page framing with X-Frame-Options or CSP.</p></section>
  </div>`;
  $('[data-panic-now]',page).onclick=panic;
  $('[data-lock-all]',page).onclick=()=>lockAll({decoy:false});
  $('[data-open-decoy]',page).onclick=()=>window.open('./decoy.html','_self');
  $('[data-decoy-settings]',page).onclick=()=>routeTo('settings');
}
function panic(){unloadFrames();sessionStorage.setItem('nox_return_hash',location.hash);location.href='./decoy.html'}

function render(){const {name,id}=parseRoute();S.route=name;$$('#main-nav a,.secondary-nav a').forEach(a=>a.classList.toggle('active',a.dataset.route===name));if(!S.currentVaultId&&name!=='vaults'){routeTo('vaults');return}if(name!=='vaults'&&S.currentVaultId&&!S.unlocked.has(S.currentVaultId)){showVaultLock(S.currentVaultId);return}if(name==='dashboard')renderDashboard();else if(name==='vaults')renderVaults();else if(name==='sessions')renderSessions();else if(name==='session')openSessionPage(id);else if(name==='library')renderLibrary();else if(name==='categories')renderCategories();else if(name==='journal')renderNotes('journal');else if(name==='notes')renderNotes('note');else if(name==='images')renderImages();else if(name==='player')renderPlayer();else if(name==='trash')renderTrash();else if(name==='settings')renderSettings();else if(name==='privacy')renderPrivacy();else routeTo('dashboard')}
function resetIdle(){S.lastActivity=Date.now();clearTimeout(S.idleTimer);if(!S.settings?.inactivityMinutes)return;S.idleTimer=setTimeout(()=>{if(backend.user)lockAll({decoy:S.settings.decoyOnLock})},Number(S.settings.inactivityMinutes)*60*1000)}
function handleActivity(){if(Date.now()-S.lastActivity>5000)resetIdle()}

let authInitInProgress=false;
async function initAuthed(){
  if(authInitInProgress)return;
  authInitInProgress=true;
  try{
    authScreen.classList.add('hidden');
    appShell.classList.remove('hidden');
    appShell.setAttribute('aria-hidden','false');
    await loadAppData();
    if(location.hash==='#unlock'){
      const ret=sessionStorage.getItem('nox_return_hash')||'#dashboard';
      history.replaceState(null,'',ret);
    }
    refreshVaultSwitcher();
    render();
    resetIdle();
  }catch(error){
    console.error('Nox Vault startup failed:',error);
    appShell.classList.add('hidden');
    authScreen.classList.remove('hidden');
    const msg=$('#login-message');
    if(msg)msg.textContent=`Signed in, but Nox Vault could not load: ${error.message||error}`;
    toast(error.message||'Nox Vault could not load.','error');
  }finally{
    authInitInProgress=false;
  }
}

$('#login-form').onsubmit=async e=>{
  e.preventDefault();
  const b=e.submitter,msg=$('#login-message');
  setBusy(b,true,'Signing in…');
  msg.textContent='';
  try{
    // onAuth() below is the single place that starts the app after a successful login.
    await backend.login($('#login-email').value,$('#login-password').value);
  }catch(err){
    console.error('Nox Vault login failed:',err);
    msg.textContent=err.message||String(err);
  }finally{
    setBusy(b,false);
  }
};

backend.onAuth(async(user,error)=>{
  if(error){
    console.error('Nox Vault authentication error:',error);
    const msg=$('#login-message');
    if(msg)msg.textContent=error.message||String(error);
    toast(error.message||'Authentication error.','error');
  }
  if(user){
    await initAuthed();
  }else{
    appShell.classList.add('hidden');
    authScreen.classList.remove('hidden');
  }
});

window.addEventListener('hashchange',render);
window.addEventListener('popstate',render);
vaultSwitcher.onchange=e=>selectVault(e.target.value);
activeLimitTop.onchange=e=>updateActiveLimit(Number(e.target.value));
$('#lock-btn').onclick=()=>lockVault(S.currentVaultId,{decoy:false});
$('#panic-btn').onclick=panic;
$('#global-search').onkeydown=e=>{if(e.key==='Enter'){S.search=e.currentTarget.value;routeTo('library')}};
window.addEventListener('keydown',e=>{
  if(S.settings&&shortcutMatches(e,S.settings.panicShortcut||'Ctrl+Shift+Space')){
    e.preventDefault();
    panic();
  }
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){
    e.preventDefault();
    $('#global-search').focus();
  }
},true);
['mousemove','mousedown','keydown','touchstart','scroll'].forEach(ev=>addEventListener(ev,handleActivity,{passive:true}));
window.addEventListener('paste',async e=>{
  if(parseRoute().name!=='images'||!S.unlocked.has(S.currentVaultId))return;
  const file=[...e.clipboardData.files].find(f=>f.type.startsWith('image/'));
  if(file){
    e.preventDefault();
    await uploadImageFile(file);
  }
});

if(backend.demoMode)toast('Demo mode is active. Configure Firebase to use the real backend.');
