import {backend} from './backend-v6.js';
import {shortcutMatches} from './utils-v6.js';

const $=s=>document.querySelector(s);
const state={settings:null,currentVaultId:localStorage.getItem('nox_current_vault')||'',sections:[],defaultIndex:0,user:null};

function neutralHtml(name='Workspace'){
  const title=String(name||'Workspace').replace(/[&<>"']/g,'');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:linear-gradient(145deg,#eef3f8,#dfe8f2);font:14px system-ui;color:#23344a}
  main{max-width:980px;margin:70px auto;padding:0 30px}.hero{background:white;border-radius:18px;padding:36px;box-shadow:0 18px 60px #7990a433}
  h1{font-size:32px;margin:0 0 8px}.muted{color:#718197}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:18px}.card{background:white;border-radius:14px;padding:20px;min-height:110px;box-shadow:0 10px 30px #7990a422}.card b{font-size:20px}
  </style></head><body><main><div class="hero"><div class="muted">Workspace</div><h1>${title}</h1><p class="muted">A neutral page is shown because this section has no custom URL yet.</p></div><div class="grid"><div class="card"><span class="muted">Documents</span><br><b>12</b></div><div class="card"><span class="muted">Tasks</span><br><b>6</b></div><div class="card"><span class="muted">Notes</span><br><b>18</b></div></div></main></body></html>`;
}
function normalizeSections(settings){
  const rows=Array.isArray(settings?.decoySections)?settings.decoySections:[];
  const out=[];
  for(let i=0;i<5;i++){
    const r=rows[i]||{};
    out.push({name:String(r.name||`Section ${i+1}`),url:String(r.url||'').trim()});
  }
  return out;
}
function loadSection(index){
  index=Math.max(0,Math.min(4,Number(index)||0));
  const section=state.sections[index]||{name:'Home',url:''};
  $('#decoy-title').textContent=section.name||`Section ${index+1}`;
  $('#decoy-url-label').textContent=section.url||'Neutral workspace';
  const external=$('#decoy-external');
  if(section.url){external.href=section.url;external.style.display='inline-block'}else{external.href='#';external.style.display='none'}
  const frame=$('#decoy-frame');
  if(section.url){frame.removeAttribute('srcdoc');frame.src=section.url}else{frame.removeAttribute('src');frame.srcdoc=neutralHtml(section.name)}
  document.querySelectorAll('#decoy-nav button[data-index]').forEach(b=>b.classList.toggle('active',Number(b.dataset.index)===index));
  $('#decoy-home').classList.toggle('active',index===state.defaultIndex);
}
function renderNav(){
  const box=$('#decoy-sections');
  box.innerHTML='';
  state.sections.forEach((s,i)=>{
    const b=document.createElement('button');
    b.dataset.index=String(i);
    b.innerHTML=`<span>▣</span>${s.name.replace(/[<>]/g,'')}`;
    b.onclick=()=>loadSection(i);
    box.append(b);
  });
  $('#decoy-home').onclick=()=>loadSection(state.defaultIndex);
}
function showUnlock(){
  $('#decoy-modal').classList.remove('hidden');
  $('#decoy-password').value='';
  $('#decoy-message').textContent='';
  setTimeout(()=>$('#decoy-password').focus(),30);
}
function hideUnlock(){$('#decoy-modal').classList.add('hidden')}
$('#decoy-unlock').onclick=showUnlock;
$('#decoy-cancel').onclick=hideUnlock;
$('#decoy-unlock-form').onsubmit=async e=>{
  e.preventDefault();
  const msg=$('#decoy-message'),btn=e.submitter;
  msg.textContent='';
  if(!state.user){msg.textContent='Your Firebase session is not signed in. Return to the login page.';return}
  if(!state.currentVaultId){msg.textContent='No current vault is selected.';return}
  btn.disabled=true;btn.textContent='Checking…';
  try{
    const ok=await backend.verifyVault(state.currentVaultId,$('#decoy-password').value);
    if(!ok)throw new Error('Incorrect vault password.');
    sessionStorage.setItem('nox_decoy_unlocked_vault',state.currentVaultId);
    const ret=sessionStorage.getItem('nox_return_hash')||'#dashboard';
    location.href=`./index.html${ret.startsWith('#')?ret:'#dashboard'}`;
  }catch(err){msg.textContent=err.message||String(err)}
  finally{btn.disabled=false;btn.textContent='Unlock'}
};

backend.onAuth(async(user,error)=>{
  if(error)console.error(error);
  state.user=user||null;
  if(user){
    try{
      state.settings=await backend.getSettings();
      state.sections=normalizeSections(state.settings);
      state.defaultIndex=Math.max(0,Math.min(4,Number(state.settings.decoyDefaultIndex||0)));
      renderNav();
      loadSection(state.defaultIndex);
    }catch(err){
      console.error(err);
      state.sections=normalizeSections(null);
      renderNav();loadSection(0);
    }
  }else{
    state.sections=normalizeSections(null);
    renderNav();loadSection(0);
  }
});
addEventListener('keydown',e=>{
  const shortcut=state.settings?.panicShortcut||localStorage.getItem('nox_panic_shortcut')||'Ctrl+Shift+Space';
  if(shortcutMatches(e,shortcut)){e.preventDefault();showUnlock()}
},true);
