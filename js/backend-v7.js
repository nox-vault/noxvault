import {
  demoMode,firebaseInitError,auth,db,signInWithEmailAndPassword,signOut,onAuthStateChanged,
  collection,doc,getDoc,getDocs,setDoc,updateDoc,deleteDoc,serverTimestamp,writeBatch,Bytes
} from './firebase-v7.js';
import { OWNER_UID } from './firebase-config.js?v=20260915-v7';
import { DEFAULT_CATEGORIES,uid,nowIso,normalizeUrl,sha256,sourceFromUrl } from './utils-v7.js';

const DEMO_KEY='nox_vault_demo_v2';
const PASSWORD_ITERATIONS=210000;
const IMAGE_CHUNK_BYTES=560*1024;
const MAX_INPUT_IMAGE_BYTES=25*1024*1024;
const MAX_STORED_IMAGE_BYTES=9*1024*1024;
const imageUrlCache=new Map();

const defaultSettings={
  maxActiveTabs:3,inactivityMinutes:10,panicShortcut:'Ctrl+Shift+Space',decoyOnLock:true,
  suspendOnLock:true,stopMediaOnLock:true,sessionAutosave:true,restoreLastSession:false,
  preloadVideos:true,blurThumbnails:false,playerShuffle:false,playerAutoplay:true,
  autoDetectPlayback:true,preferDetectedPlayer:true,
  decoyDefaultIndex:0,
  decoySections:[
    {name:'Home',url:''},
    {name:'Documents',url:''},
    {name:'Notes',url:''},
    {name:'Calendar',url:''},
    {name:'News',url:''}
  ]
};

function demoSeed(){
  const v1='demo-personal',v2='demo-archive';
  const cats={};DEFAULT_CATEGORIES.forEach(([name,color],i)=>cats[`cat-${i}`]={id:`cat-${i}`,name,color,createdAt:nowIso()});
  return {user:{uid:'demo-owner',email:'demo@nox.local'},settings:defaultSettings,vaults:{
    [v1]:{id:v1,name:'Personal',description:'Main private collection',color:'#3377ff',createdAt:nowIso(),lastOpenedAt:nowIso()},
    [v2]:{id:v2,name:'Archive',description:'Saved references',color:'#6758ff',createdAt:nowIso(),lastOpenedAt:null}
  },vaultSecrets:{[v1]:'1234',[v2]:'1234'},categories:{[v1]:cats,[v2]:{}},items:{[v1]:{},[v2]:{}},sessions:{[v1]:{},[v2]:{}},notes:{[v1]:{},[v2]:{}},images:{[v1]:{},[v2]:{}},trash:{[v1]:{},[v2]:{}}};
}
function loadDemo(){let x;try{x=JSON.parse(localStorage.getItem(DEMO_KEY)||'null')}catch{};if(!x){x=demoSeed();saveDemo(x)}return x}
function saveDemo(x){localStorage.setItem(DEMO_KEY,JSON.stringify(x))}
let demo=demoMode?loadDemo():null;
let currentUser=demoMode?demo.user:null;


function firebaseReadyGuard(){
  if(demoMode) return;
  if(firebaseInitError) {
    throw new Error('Firebase could not load. Check your internet connection and Firebase web configuration.');
  }
  if(!auth || !db || !signInWithEmailAndPassword || !onAuthStateChanged) {
    throw new Error('Firebase did not initialize correctly. Verify web/js/firebase-config.js.');
  }
}

function friendlyAuthError(error){
  const code=error?.code||'';
  const map={
    'auth/invalid-credential':'Incorrect email or password.',
    'auth/invalid-login-credentials':'Incorrect email or password.',
    'auth/user-not-found':'Incorrect email or password.',
    'auth/wrong-password':'Incorrect email or password.',
    'auth/invalid-email':'Enter a valid email address.',
    'auth/user-disabled':'This Firebase Authentication user is disabled.',
    'auth/too-many-requests':'Too many login attempts. Wait a little and try again.',
    'auth/network-request-failed':'Firebase could not be reached. Check your internet connection.',
    'auth/api-key-not-valid.-please-pass-a-valid-api-key.':'The Firebase API key is invalid. Check web/js/firebase-config.js.',
    'auth/unauthorized-domain':'This GitHub Pages domain is not authorized in Firebase Authentication.'
  };
  if(map[code]) return new Error(map[code]);
  const message=error?.message ? String(error.message).replace(/^Firebase:\s*/,'') : 'Firebase sign-in failed.';
  return new Error(message);
}

function ownerGuard(user){
  if(!user)throw new Error('Not signed in');
  if(!demoMode&&OWNER_UID&&!OWNER_UID.startsWith('PASTE_')&&!OWNER_UID.startsWith('YOUR_')&&user.uid!==OWNER_UID){
    throw new Error('This account is not the configured Nox Vault owner.');
  }
}
function userRoot(){ownerGuard(currentUser);return ['users',currentUser.uid]}
function cpath(vaultId,name){return [...userRoot(),'vaults',vaultId,name]}
async function listCol(path){const snap=await getDocs(collection(db,...path));return snap.docs.map(d=>({id:d.id,...d.data()}))}
function demoBucket(type,vaultId){demo[type][vaultId]??={};return demo[type][vaultId]}
function ts(v){return demoMode?(v||nowIso()):serverTimestamp()}

function bytesToBase64(bytes){
  let out='';
  const chunk=0x8000;
  for(let i=0;i<bytes.length;i+=chunk)out+=String.fromCharCode(...bytes.subarray(i,i+chunk));
  return btoa(out);
}
function base64ToBytes(base64){
  const s=atob(base64),out=new Uint8Array(s.length);
  for(let i=0;i<s.length;i++)out[i]=s.charCodeAt(i);
  return out;
}
function randomBytes(n=16){const b=new Uint8Array(n);crypto.getRandomValues(b);return b}
async function derivePasswordHash(password,salt,iterations=PASSWORD_ITERATIONS){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations,hash:'SHA-256'},key,256);
  return bytesToBase64(new Uint8Array(bits));
}
async function makePasswordRecord(password){
  if(!password||password.length<1)throw new Error('Vault password cannot be empty.');
  const salt=randomBytes(16);
  return {lockSalt:bytesToBase64(salt),lockHash:await derivePasswordHash(password,salt),lockIterations:PASSWORD_ITERATIONS,lockVersion:1};
}
async function verifyPasswordRecord(vault,password){
  if(!vault?.lockHash||!vault?.lockSalt)return false;
  const hash=await derivePasswordHash(password,base64ToBytes(vault.lockSalt),Number(vault.lockIterations||PASSWORD_ITERATIONS));
  const a=new TextEncoder().encode(hash),b=new TextEncoder().encode(vault.lockHash);
  if(a.length!==b.length)return false;
  let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
  return diff===0;
}

async function deleteCollectionPath(path){
  const snap=await getDocs(collection(db,...path));
  for(const d of snap.docs)await deleteDoc(d.ref);
}
async function deleteImageChunks(vaultId,imageId){
  await deleteCollectionPath([...cpath(vaultId,'images'),imageId,'chunks']);
}

function fileToDataUrl(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(blob)})}
function loadBitmap(file){
  if('createImageBitmap' in window)return createImageBitmap(file);
  return new Promise((resolve,reject)=>{const u=URL.createObjectURL(file),img=new Image();img.onload=()=>{URL.revokeObjectURL(u);resolve(img)};img.onerror=e=>{URL.revokeObjectURL(u);reject(e)};img.src=u})
}
function canvasBlob(canvas,type='image/webp',quality=.82){return new Promise(resolve=>canvas.toBlob(resolve,type,quality))}
async function resizeImage(file,{maxDimension=2200,quality=.82}={}){
  if(!file?.type?.startsWith('image/'))throw new Error('Please choose an image file.');
  if(file.size>MAX_INPUT_IMAGE_BYTES)throw new Error('Image is too large. Choose an image below 25 MB.');
  const bitmap=await loadBitmap(file);
  const w=bitmap.width||bitmap.naturalWidth,h=bitmap.height||bitmap.naturalHeight;
  if(!w||!h)throw new Error('Could not read image dimensions.');
  const scale=Math.min(1,maxDimension/Math.max(w,h));
  const outW=Math.max(1,Math.round(w*scale)),outH=Math.max(1,Math.round(h*scale));
  const canvas=document.createElement('canvas');canvas.width=outW;canvas.height=outH;
  const ctx=canvas.getContext('2d',{alpha:false});ctx.drawImage(bitmap,0,0,outW,outH);bitmap.close?.();
  let blob=await canvasBlob(canvas,'image/webp',quality);
  if(!blob)blob=await canvasBlob(canvas,'image/jpeg',quality);
  if(!blob)throw new Error('Your browser could not process this image.');
  if(blob.size>MAX_STORED_IMAGE_BYTES){
    blob=await canvasBlob(canvas,'image/webp',.62) || blob;
  }
  if(blob.size>MAX_STORED_IMAGE_BYTES)throw new Error('Image is still too large after compression. Try a smaller image.');
  const thumbScale=Math.min(1,420/Math.max(outW,outH));
  const tw=Math.max(1,Math.round(outW*thumbScale)),th=Math.max(1,Math.round(outH*thumbScale));
  const tc=document.createElement('canvas');tc.width=tw;tc.height=th;tc.getContext('2d',{alpha:false}).drawImage(canvas,0,0,tw,th);
  const thumbBlob=await canvasBlob(tc,'image/webp',.7) || await canvasBlob(tc,'image/jpeg',.7);
  return {blob,width:outW,height:outH,mimeType:blob.type||'image/webp',thumbnailDataUrl:await fileToDataUrl(thumbBlob)};
}

function inferEmbedUrl(url){
  try{
    const u=new URL(url);
    const host=u.hostname.toLowerCase().replace(/^www\./,'');
    const path=u.pathname;

    // Already an embed/player URL: keep it as-is.
    if(/\/(embed|embedframe|player)\//i.test(path)||/xembed\.php/i.test(path))return u.href;

    // xHamster: normal video URLs end with a compact public video code.
    // Converting that code to /embed/<code> does not require scraping the page,
    // so it works even though xHamster blocks browser-side metadata fetches with CORS.
    if(host.includes('xhamster')){
      const qid=u.searchParams.get('video')||u.searchParams.get('id');
      if(qid&&/^[a-z0-9]+$/i.test(qid))return `https://xhamster.com/embed/${encodeURIComponent(qid)}`;
      const seg=path.split('/').filter(Boolean).pop()||'';
      const modern=seg.match(/-(xh[a-z0-9]+)$/i)?.[1];
      if(modern)return `https://xhamster.com/embed/${encodeURIComponent(modern)}`;
      const numeric=seg.match(/-(\d+)$/)?.[1];
      if(numeric)return `https://xhamster.com/embed/${encodeURIComponent(numeric)}`;
    }

    // Pornhub: viewkey maps directly to the site's embed endpoint.
    if(host.includes('pornhub.')){
      const key=u.searchParams.get('viewkey');
      if(key&&/^[a-z0-9]+$/i.test(key))return `https://www.pornhub.com/embed/${encodeURIComponent(key)}`;
    }

    // Xvideos has a stable numeric id in its public video URL.
    if(host.endsWith('xvideos.com')){
      const id=path.match(/\/video(?:\.|)(\d+)/i)?.[1];
      if(id)return `https://www.xvideos.com/embedframe/${encodeURIComponent(id)}`;
    }
  }catch{}
  return '';
}

function inferMetadata(url){
  let title='Saved Link',source=sourceFromUrl(url),path='';
  try{
    const u=new URL(url);path=decodeURIComponent(u.pathname).replace(/\.[a-z0-9]{2,5}$/i,'');
    const slug=path.split('/').filter(Boolean).pop()||u.hostname;
    title=slug.replace(/[-_+]+/g,' ').replace(/\s+/g,' ').trim().replace(/\b\w/g,c=>c.toUpperCase())||source;
  }catch{}
  const text=`${title} ${path} ${url}`.toLowerCase();
  const catTerms={
    'Soft':['soft','romantic','sensual'], 'Hardcore':['hardcore','rough'], 'Oral':['oral','blowjob','bj','cunnilingus'],
    'Masturbation':['masturbat','jerk','handjob'], 'Solo':['solo'], 'Couples':['couple','couples'],
    'Amateur':['amateur','homemade'], 'Professional':['professional','studio'], 'Anal':['anal']
  };
  const suggestedCategories=Object.entries(catTerms).filter(([,terms])=>terms.some(t=>text.includes(t))).map(([name])=>name);
  const stop=new Set(['https','http','www','com','html','video','watch','view','pornhub','xhamster']);
  const tags=[...new Set(text.split(/[^a-z0-9]+/).filter(x=>x.length>2&&!stop.has(x)))].slice(0,12);
  return {title,source,thumbnail:'',embedUrl:inferEmbedUrl(url),mediaUrl:'',tags,suggestedCategories,related:[]};
}
async function fetchTextLimited(response,max=700000){
  if(!response.body)return (await response.text()).slice(0,max);
  const reader=response.body.getReader(),parts=[];let total=0;
  while(total<max){const {done,value}=await reader.read();if(done)break;const take=value.subarray(0,Math.min(value.length,max-total));parts.push(take);total+=take.length;if(take.length<value.length){try{await reader.cancel()}catch{};break}}
  const out=new Uint8Array(total);let o=0;for(const p of parts){out.set(p,o);o+=p.length}return new TextDecoder().decode(out);
}
function parsePageMetadata(html,url,base){
  const d=new DOMParser().parseFromString(html,'text/html');
  const meta=(...keys)=>{for(const k of keys){const e=d.querySelector(`meta[property="${k}"],meta[name="${k}"]`);if(e?.content)return e.content.trim()}return ''};
  const abs=v=>{try{return v?new URL(v,url).href:''}catch{return v||''}};
  const title=meta('og:title','twitter:title')||d.title?.trim()||base.title;
  let thumbnail=abs(meta('og:image','twitter:image'));
  let mediaUrl=abs(meta('og:video:secure_url','og:video:url','og:video'));
  let embedUrl=abs(meta('twitter:player'))||base.embedUrl||'';
  const keywords=meta('keywords').split(',').map(x=>x.trim()).filter(Boolean);

  const jsonLd=[];
  for(const el of d.querySelectorAll('script[type="application/ld+json"]')){
    try{
      const parsed=JSON.parse(el.textContent||'null');
      if(Array.isArray(parsed))jsonLd.push(...parsed);else if(parsed)jsonLd.push(parsed);
    }catch{}
  }
  const visit=value=>{
    if(!value||typeof value!=='object')return;
    if(Array.isArray(value)){value.forEach(visit);return}
    const type=Array.isArray(value['@type'])?value['@type'].join(' '):String(value['@type']||'');
    if(/VideoObject/i.test(type)||value.embedUrl||value.contentUrl){
      if(!embedUrl&&value.embedUrl)embedUrl=abs(value.embedUrl);
      if(!mediaUrl&&value.contentUrl)mediaUrl=abs(value.contentUrl);
      if(!thumbnail){
        const t=Array.isArray(value.thumbnailUrl)?value.thumbnailUrl[0]:value.thumbnailUrl;
        if(t)thumbnail=abs(t);
      }
    }
    for(const v of Object.values(value))visit(v);
  };
  jsonLd.forEach(visit);

  if(!embedUrl){
    const frame=[...d.querySelectorAll('iframe[src]')].find(f=>/embed|player|xembed|video/i.test(f.getAttribute('src')||''));
    if(frame)embedUrl=abs(frame.getAttribute('src'));
  }
  if(!mediaUrl){
    const source=d.querySelector('video[src], video source[src], source[type^="video/"][src]');
    if(source)mediaUrl=abs(source.getAttribute('src'));
  }

  const related=[];
  const seen=new Set([url]);
  const candidates=[...d.querySelectorAll('a[href*="/video"],a[href*="/videos/"],a[href*="viewkey="]')];
  for(const a of candidates){
    if(related.length>=16)break;
    const href=abs(a.getAttribute('href'));
    if(!href||seen.has(href))continue;
    seen.add(href);
    const img=a.querySelector('img');
    const label=(a.getAttribute('title')||img?.getAttribute('alt')||a.textContent||'').replace(/\s+/g,' ').trim();
    const imgUrl=abs(img?.getAttribute('src')||img?.getAttribute('data-src')||img?.getAttribute('data-lazy-src')||'');
    if(label||imgUrl)related.push({title:label||sourceFromUrl(href),url:href,thumbnail:imgUrl});
  }

  const merged=inferMetadata(`${url} ${title} ${keywords.join(' ')}`);
  return {
    ...base,...merged,title,thumbnail,embedUrl:embedUrl||merged.embedUrl||base.embedUrl||'',
    mediaUrl:mediaUrl||'',related,
    tags:[...new Set([...(base.tags||[]),...keywords,...merged.tags])].slice(0,30),
    suggestedCategories:[...new Set([...(base.suggestedCategories||[]),...merged.suggestedCategories])]
  };
}

export const backend={
  demoMode,
  onAuth(cb){
    if(demoMode){setTimeout(()=>cb(currentUser),0);return()=>{}}
    try{
      firebaseReadyGuard();
      return onAuthStateChanged(auth,u=>{
        try{
          if(u) ownerGuard(u);
          currentUser=u;
          cb(u);
        }catch(e){
          signOut(auth).catch(()=>{});
          cb(null,e);
        }
      },err=>cb(null,friendlyAuthError(err)));
    }catch(error){
      setTimeout(()=>cb(null,error),0);
      return()=>{};
    }
  },
  async login(email,password){
    if(demoMode){currentUser=demo.user;return currentUser}
    firebaseReadyGuard();
    try{
      const cred=await signInWithEmailAndPassword(auth,email,password);
      ownerGuard(cred.user);
      currentUser=cred.user;
      return currentUser;
    }catch(error){
      throw friendlyAuthError(error);
    }
  },
  async logout(){
    if(demoMode){currentUser=null;return}
    firebaseReadyGuard();
    await signOut(auth);
  },
  get user(){return currentUser},

  async getSettings(){if(demoMode)return {...defaultSettings,...demo.settings};const ref=doc(db,...userRoot(),'settings','app');const s=await getDoc(ref);if(!s.exists()){await setDoc(ref,defaultSettings);return {...defaultSettings}}return {...defaultSettings,...s.data()}},
  async saveSettings(patch){if(demoMode){demo.settings={...demo.settings,...patch};saveDemo(demo);return demo.settings}await setDoc(doc(db,...userRoot(),'settings','app'),patch,{merge:true});return patch},

  async listVaults(){if(demoMode)return Object.values(demo.vaults);return listCol([...userRoot(),'vaults'])},
  async createVault({name,password,description='',color='#3377ff'}){
    if(demoMode){const id=uid();demo.vaults[id]={id,name,description,color,createdAt:nowIso(),lastOpenedAt:null};demo.vaultSecrets[id]=password;['categories','items','sessions','notes','images','trash'].forEach(k=>demo[k][id]={});DEFAULT_CATEGORIES.forEach(([n,c],i)=>demo.categories[id][`cat-${i}`]={id:`cat-${i}`,name:n,color:c,createdAt:nowIso()});saveDemo(demo);return id}
    const id=uid(),lock=await makePasswordRecord(password);
    await setDoc(doc(db,...userRoot(),'vaults',id),{id,name,description,color,createdAt:serverTimestamp(),lastOpenedAt:null,...lock});
    for(const [n,c] of DEFAULT_CATEGORIES)await this.saveCategory(id,{name:n,color:c});
    return id;
  },
  async verifyVault(vaultId,password){
    if(demoMode)return demo.vaultSecrets[vaultId]===password;
    const s=await getDoc(doc(db,...userRoot(),'vaults',vaultId));
    return s.exists()?verifyPasswordRecord(s.data(),password):false;
  },
  async changeVaultPassword(vaultId,password){
    if(demoMode){demo.vaultSecrets[vaultId]=password;saveDemo(demo);return}
    await updateDoc(doc(db,...userRoot(),'vaults',vaultId),await makePasswordRecord(password));
  },
  async updateVault(vaultId,patch){if(demoMode){Object.assign(demo.vaults[vaultId],patch);saveDemo(demo);return}await updateDoc(doc(db,...userRoot(),'vaults',vaultId),patch)},
  async touchVault(vaultId){return this.updateVault(vaultId,{lastOpenedAt:ts()})},
  async deleteVault(vaultId){
    if(demoMode){delete demo.vaults[vaultId];delete demo.vaultSecrets[vaultId];['categories','items','sessions','notes','images','trash'].forEach(k=>delete demo[k][vaultId]);saveDemo(demo);return}
    const images=await this.listImages(vaultId);
    for(const image of images)await deleteImageChunks(vaultId,image.id);
    for(const name of ['categories','items','sessions','notes','images','trash'])await deleteCollectionPath(cpath(vaultId,name));
    await deleteDoc(doc(db,...userRoot(),'vaults',vaultId));
  },

  async listCategories(vaultId){if(demoMode)return Object.values(demoBucket('categories',vaultId));return listCol(cpath(vaultId,'categories'))},
  async saveCategory(vaultId,data){const id=data.id||uid();const row={id,name:data.name,color:data.color||'#3377ff',createdAt:data.createdAt||ts()};if(demoMode){demoBucket('categories',vaultId)[id]=row;saveDemo(demo);return row}await setDoc(doc(db,...cpath(vaultId,'categories'),id),row,{merge:true});return row},
  async deleteCategory(vaultId,id){if(demoMode){delete demoBucket('categories',vaultId)[id];saveDemo(demo);return}await deleteDoc(doc(db,...cpath(vaultId,'categories'),id))},

  async listItems(vaultId,includeDeleted=false){let rows;if(demoMode)rows=Object.values(demoBucket('items',vaultId));else rows=await listCol(cpath(vaultId,'items'));return rows.filter(x=>includeDeleted?true:!x.deletedAt)},
  async getItem(vaultId,id){if(demoMode)return demoBucket('items',vaultId)[id]||null;const s=await getDoc(doc(db,...cpath(vaultId,'items'),id));return s.exists()?{id:s.id,...s.data()}:null},
  async saveItem(vaultId,data,{skipIfExists=true}={}){const normalizedUrl=normalizeUrl(data.url||'');const id=data.id||await sha256(normalizedUrl);const existing=await this.getItem(vaultId,id);if(existing&&skipIfExists)return {status:'skipped',item:existing};const row={id,title:data.title||normalizedUrl,url:data.url,normalizedUrl,source:data.source||sourceFromUrl(data.url),thumbnail:data.thumbnail||'',embedUrl:data.embedUrl||'',mediaUrl:data.mediaUrl||'',playbackMode:data.playbackMode||'auto',related:Array.isArray(data.related)?data.related.slice(0,16):[],categories:data.categories||[],tags:data.tags||[],favorite:!!data.favorite,notes:data.notes||'',duration:data.duration||'',createdAt:data.createdAt||ts(),lastViewedAt:data.lastViewedAt||null,viewCount:Number(data.viewCount||0),deletedAt:null};if(demoMode){demoBucket('items',vaultId)[id]={...existing,...row};saveDemo(demo);return {status:existing?'updated':'saved',item:demoBucket('items',vaultId)[id]}}await setDoc(doc(db,...cpath(vaultId,'items'),id),row,{merge:true});return {status:existing?'updated':'saved',item:{...existing,...row}}},
  async updateItem(vaultId,id,patch){if(demoMode){Object.assign(demoBucket('items',vaultId)[id],patch);saveDemo(demo);return}await updateDoc(doc(db,...cpath(vaultId,'items'),id),patch)},
  async markViewed(vaultId,id){const item=await this.getItem(vaultId,id);if(!item)return;await this.updateItem(vaultId,id,{lastViewedAt:ts(),viewCount:Number(item.viewCount||0)+1})},
  async trashItem(vaultId,id){await this.updateItem(vaultId,id,{deletedAt:ts()})},
  async restoreItem(vaultId,id){await this.updateItem(vaultId,id,{deletedAt:null})},
  async deleteItemForever(vaultId,id){if(demoMode){delete demoBucket('items',vaultId)[id];saveDemo(demo);return}await deleteDoc(doc(db,...cpath(vaultId,'items'),id))},

  async listSessions(vaultId){if(demoMode)return Object.values(demoBucket('sessions',vaultId));return listCol(cpath(vaultId,'sessions'))},
  async saveSession(vaultId,data){const id=data.id||uid();const row={id,name:data.name||'Untitled Session',tabs:data.tabs||[],categoryIds:data.categoryIds||[],createdAt:data.createdAt||ts(),updatedAt:ts(),lastOpenedAt:data.lastOpenedAt||null};if(demoMode){demoBucket('sessions',vaultId)[id]={...demoBucket('sessions',vaultId)[id],...row};saveDemo(demo);return row}await setDoc(doc(db,...cpath(vaultId,'sessions'),id),row,{merge:true});return row},
  async deleteSession(vaultId,id){if(demoMode){delete demoBucket('sessions',vaultId)[id];saveDemo(demo);return}await deleteDoc(doc(db,...cpath(vaultId,'sessions'),id))},

  async listNotes(vaultId){if(demoMode)return Object.values(demoBucket('notes',vaultId));return listCol(cpath(vaultId,'notes'))},
  async saveNote(vaultId,data){const id=data.id||uid();const row={id,type:data.type||'note',title:data.title||'Untitled',body:data.body||'',tags:data.tags||[],linkedItemIds:data.linkedItemIds||[],createdAt:data.createdAt||ts(),updatedAt:ts()};if(demoMode){demoBucket('notes',vaultId)[id]={...demoBucket('notes',vaultId)[id],...row};saveDemo(demo);return row}await setDoc(doc(db,...cpath(vaultId,'notes'),id),row,{merge:true});return row},
  async deleteNote(vaultId,id){if(demoMode){delete demoBucket('notes',vaultId)[id];saveDemo(demo);return}await deleteDoc(doc(db,...cpath(vaultId,'notes'),id))},

  async listImages(vaultId){if(demoMode)return Object.values(demoBucket('images',vaultId));return listCol(cpath(vaultId,'images'))},
  async uploadImage(vaultId,file,{caption='',tags=[]}={}){
    const id=uid();
    if(demoMode){const url=await fileToDataUrl(file);const row={id,name:file.name||'image',url,thumbnailDataUrl:url,storage:'demo',caption,tags,createdAt:nowIso()};demoBucket('images',vaultId)[id]=row;saveDemo(demo);return row}
    const p=await resizeImage(file),data=new Uint8Array(await p.blob.arrayBuffer()),chunkCount=Math.ceil(data.length/IMAGE_CHUNK_BYTES);
    const batch=writeBatch(db);
    for(let i=0;i<chunkCount;i++){
      const chunk=data.subarray(i*IMAGE_CHUNK_BYTES,Math.min(data.length,(i+1)*IMAGE_CHUNK_BYTES));
      batch.set(doc(db,...cpath(vaultId,'images'),id,'chunks',String(i).padStart(4,'0')),{index:i,data:Bytes.fromUint8Array(chunk)});
    }
    const row={id,name:file.name||`image-${id}.webp`,caption,tags,createdAt:serverTimestamp(),mimeType:p.mimeType,size:data.length,width:p.width,height:p.height,chunkCount,thumbnailDataUrl:p.thumbnailDataUrl,storage:'firestore-chunks'};
    batch.set(doc(db,...cpath(vaultId,'images'),id),row);
    await batch.commit();
    return row;
  },
  async getImageUrl(vaultId,image){
    if(image?.url)return image.url;
    const key=`${vaultId}:${image.id}`;if(imageUrlCache.has(key))return imageUrlCache.get(key);
    const snap=await getDocs(collection(db,...cpath(vaultId,'images'),image.id,'chunks'));
    const chunks=snap.docs.map(d=>d.data()).sort((a,b)=>a.index-b.index).map(x=>x.data.toUint8Array());
    const total=chunks.reduce((n,x)=>n+x.length,0),out=new Uint8Array(total);let pos=0;for(const c of chunks){out.set(c,pos);pos+=c.length}
    const url=URL.createObjectURL(new Blob([out],{type:image.mimeType||'image/webp'}));imageUrlCache.set(key,url);return url;
  },
  async importRemoteImage(vaultId,url){
    let u;try{u=new URL(url)}catch{throw new Error('Enter a valid image URL.')}
    if(!['http:','https:','data:'].includes(u.protocol))throw new Error('Only http/https image URLs are supported.');
    let r;try{r=await fetch(url,{mode:'cors',credentials:'omit',referrerPolicy:'no-referrer'})}catch{throw new Error('The image host blocked browser downloads (CORS). Use Upload, Take Photo, or copy/paste the image instead.')}
    if(!r.ok)throw new Error(`Image download failed (${r.status}).`);
    const blob=await r.blob();if(!blob.type.startsWith('image/'))throw new Error('That URL did not return an image.');
    if(blob.size>MAX_INPUT_IMAGE_BYTES)throw new Error('Remote image is larger than 25 MB.');
    const name=(u.pathname.split('/').pop()||`remote-${Date.now()}`).split('?')[0];
    return this.uploadImage(vaultId,new File([blob],name,{type:blob.type}));
  },
  async deleteImage(vaultId,image){
    if(demoMode){delete demoBucket('images',vaultId)[image.id];saveDemo(demo);return}
    await deleteImageChunks(vaultId,image.id);
    await deleteDoc(doc(db,...cpath(vaultId,'images'),image.id));
    const key=`${vaultId}:${image.id}`;if(imageUrlCache.has(key)){URL.revokeObjectURL(imageUrlCache.get(key));imageUrlCache.delete(key)}
  },

  // Resolve what can be derived from the URL itself without a cross-origin request.
  // This is intentionally synchronous and CORS-free so opening a tab never produces
  // noisy blocked fetches on sites such as xHamster.
  resolveUrl(url){return inferMetadata(url)},

  async fetchMetadata(url){
    const base=inferMetadata(url);
    if(demoMode)return base;

    // A static GitHub Pages app cannot read arbitrary third-party HTML when the site
    // does not grant CORS access. Only inspect same-origin HTML; for external sites,
    // use deterministic URL resolvers (embed URL, title/tags from the slug, etc.).
    try{
      const u=new URL(url,location.href);
      if(u.origin!==location.origin)return base;
      const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),3500);
      try{
        const r=await fetch(u.href,{credentials:'same-origin',signal:ctl.signal});
        const type=r.headers.get('content-type')||'';
        if(r.ok&&type.includes('text/html'))return parsePageMetadata(await fetchTextLimited(r),u.href,base);
      }finally{clearTimeout(timer)}
    }catch{}
    return base;
  },

  async exportVault(vaultId){const [vaults,categories,items,sessions,notes,images]=await Promise.all([this.listVaults(),this.listCategories(vaultId),this.listItems(vaultId,true),this.listSessions(vaultId),this.listNotes(vaultId),this.listImages(vaultId)]);const vault=vaults.find(v=>v.id===vaultId)||null;const cleanVault=vault?Object.fromEntries(Object.entries(vault).filter(([k])=>!['lockHash','lockSalt','lockIterations','lockVersion'].includes(k))):null;return {version:2,exportedAt:nowIso(),vault:cleanVault,categories,items,sessions,notes,images}},
  async importVaultData(vaultId,data){for(const c of data.categories||[])await this.saveCategory(vaultId,c);for(const i of data.items||[])await this.saveItem(vaultId,i,{skipIfExists:true});for(const s of data.sessions||[])await this.saveSession(vaultId,s);for(const n of data.notes||[])await this.saveNote(vaultId,n);return true},
  async seedDefaultCategories(vaultId){const existing=await this.listCategories(vaultId);if(existing.length)return;for(const [name,color] of DEFAULT_CATEGORIES)await this.saveCategory(vaultId,{name,color})}
};
