import { demoMode,auth,db,storage,functions,signInWithEmailAndPassword,signOut,onAuthStateChanged,collection,doc,getDoc,getDocs,setDoc,addDoc,updateDoc,deleteDoc,query,orderBy,serverTimestamp,writeBatch,storageRef,uploadBytes,getDownloadURL,deleteObject,httpsCallable } from './firebase.js';
import { OWNER_UID } from './firebase-config.js';
import { DEFAULT_CATEGORIES,uid,nowIso,normalizeUrl,sha256,sourceFromUrl } from './utils.js';

const DEMO_KEY='nox_vault_demo_v1';
const defaultSettings={maxActiveTabs:3,inactivityMinutes:10,panicShortcut:'Ctrl+Shift+Space',decoyOnLock:true,suspendOnLock:true,stopMediaOnLock:true,sessionAutosave:true,restoreLastSession:false,preloadVideos:true,blurThumbnails:false,playerShuffle:false,playerAutoplay:true};
function demoSeed(){
  const v1='demo-personal',v2='demo-archive';
  const cats={};DEFAULT_CATEGORIES.forEach(([name,color],i)=>cats[`cat-${i}`]={id:`cat-${i}`,name,color,createdAt:nowIso()});
  return {user:{uid:'demo-owner',email:'demo@nox.local'},settings:defaultSettings,vaults:{
    [v1]:{id:v1,name:'Personal',description:'Main private collection',color:'#3377ff',createdAt:nowIso(),lastOpenedAt:nowIso()},
    [v2]:{id:v2,name:'Archive',description:'Saved references',color:'#6758ff',createdAt:nowIso(),lastOpenedAt:null}
  },vaultSecrets:{[v1]:'1234',[v2]:'1234'},categories:{[v1]:cats,[v2]:{}},items:{[v1]:{},[v2]:{}},sessions:{[v1]:{},[v2]:{}},notes:{[v1]:{},[v2]:{}},images:{[v1]:{},[v2]:{}},trash:{[v1]:{},[v2]:{}}};
}
function loadDemo(){let x;try{x=JSON.parse(localStorage.getItem(DEMO_KEY)||'null')}catch{};if(!x){x=demoSeed();saveDemo(x)}return x}function saveDemo(x){localStorage.setItem(DEMO_KEY,JSON.stringify(x))}
let demo=demoMode?loadDemo():null;
let currentUser=demoMode?demo.user:null;

function ownerGuard(user){if(!user)throw new Error('Not signed in');if(!demoMode&&OWNER_UID&&!OWNER_UID.startsWith('YOUR_')&&user.uid!==OWNER_UID)throw new Error('This account is not the configured Nox Vault owner.');}
function userRoot(){ownerGuard(currentUser);return ['users',currentUser.uid]}
function cpath(vaultId,name){return [...userRoot(),'vaults',vaultId,name]}
async function listCol(path){const snap=await getDocs(collection(db,...path));return snap.docs.map(d=>({id:d.id,...d.data()}));}
function demoBucket(type,vaultId){demo[type][vaultId]??={};return demo[type][vaultId]}
function ts(v){return demoMode?(v||nowIso()):serverTimestamp()}

export const backend={
  demoMode,
  onAuth(cb){
    if(demoMode){setTimeout(()=>cb(currentUser),0);return()=>{}};
    return onAuthStateChanged(auth,u=>{try{if(u)ownerGuard(u);currentUser=u;cb(u)}catch(e){signOut(auth);cb(null,e)}});
  },
  async login(email,password){if(demoMode){currentUser=demo.user;return currentUser}const cred=await signInWithEmailAndPassword(auth,email,password);ownerGuard(cred.user);currentUser=cred.user;return currentUser},
  async logout(){if(demoMode){currentUser=null;return}await signOut(auth)},
  get user(){return currentUser},
  async getSettings(){if(demoMode)return {...defaultSettings,...demo.settings};const ref=doc(db,...userRoot(),'settings','app');const s=await getDoc(ref);if(!s.exists()){await setDoc(ref,defaultSettings);return {...defaultSettings}}return {...defaultSettings,...s.data()}},
  async saveSettings(patch){if(demoMode){demo.settings={...demo.settings,...patch};saveDemo(demo);return demo.settings}await setDoc(doc(db,...userRoot(),'settings','app'),patch,{merge:true});return patch},
  async listVaults(){if(demoMode)return Object.values(demo.vaults);return listCol([...userRoot(),'vaults'])},
  async createVault({name,password,description='',color='#3377ff'}){if(demoMode){const id=uid();demo.vaults[id]={id,name,description,color,createdAt:nowIso(),lastOpenedAt:null};demo.vaultSecrets[id]=password;['categories','items','sessions','notes','images','trash'].forEach(k=>demo[k][id]={});DEFAULT_CATEGORIES.forEach(([n,c],i)=>demo.categories[id][`cat-${i}`]={id:`cat-${i}`,name:n,color:c,createdAt:nowIso()});saveDemo(demo);return id}const call=httpsCallable(functions,'createVault');const r=await call({name,password,description,color});return r.data.vaultId},
  async verifyVault(vaultId,password){if(demoMode)return demo.vaultSecrets[vaultId]===password;const call=httpsCallable(functions,'verifyVaultPassword');const r=await call({vaultId,password});return !!r.data.ok},
  async changeVaultPassword(vaultId,password){if(demoMode){demo.vaultSecrets[vaultId]=password;saveDemo(demo);return}const call=httpsCallable(functions,'setVaultPassword');await call({vaultId,password})},
  async updateVault(vaultId,patch){if(demoMode){Object.assign(demo.vaults[vaultId],patch);saveDemo(demo);return}await updateDoc(doc(db,...userRoot(),'vaults',vaultId),patch)},
  async touchVault(vaultId){return this.updateVault(vaultId,{lastOpenedAt:ts()})},
  async deleteVault(vaultId){if(demoMode){delete demo.vaults[vaultId];delete demo.vaultSecrets[vaultId];['categories','items','sessions','notes','images','trash'].forEach(k=>delete demo[k][vaultId]);saveDemo(demo);return}const call=httpsCallable(functions,'deleteVault');await call({vaultId})},
  async listCategories(vaultId){if(demoMode)return Object.values(demoBucket('categories',vaultId));return listCol(cpath(vaultId,'categories'))},
  async saveCategory(vaultId,data){const id=data.id||uid();const row={id,name:data.name,color:data.color||'#3377ff',createdAt:data.createdAt||ts()};if(demoMode){demoBucket('categories',vaultId)[id]=row;saveDemo(demo);return row}await setDoc(doc(db,...cpath(vaultId,'categories'),id),row,{merge:true});return row},
  async deleteCategory(vaultId,id){if(demoMode){delete demoBucket('categories',vaultId)[id];saveDemo(demo);return}await deleteDoc(doc(db,...cpath(vaultId,'categories'),id))},
  async listItems(vaultId,includeDeleted=false){let rows;if(demoMode)rows=Object.values(demoBucket('items',vaultId));else rows=await listCol(cpath(vaultId,'items'));return rows.filter(x=>includeDeleted?true:!x.deletedAt)},
  async getItem(vaultId,id){if(demoMode)return demoBucket('items',vaultId)[id]||null;const s=await getDoc(doc(db,...cpath(vaultId,'items'),id));return s.exists()?{id:s.id,...s.data()}:null},
  async saveItem(vaultId,data,{skipIfExists=true}={}){const normalizedUrl=normalizeUrl(data.url||'');const id=data.id||await sha256(normalizedUrl);const existing=await this.getItem(vaultId,id);if(existing&&skipIfExists)return {status:'skipped',item:existing};const row={id,title:data.title||normalizedUrl,url:data.url,normalizedUrl,source:data.source||sourceFromUrl(data.url),thumbnail:data.thumbnail||'',embedUrl:data.embedUrl||'',mediaUrl:data.mediaUrl||'',categories:data.categories||[],tags:data.tags||[],favorite:!!data.favorite,notes:data.notes||'',duration:data.duration||'',createdAt:data.createdAt||ts(),lastViewedAt:data.lastViewedAt||null,viewCount:Number(data.viewCount||0),deletedAt:null};if(demoMode){demoBucket('items',vaultId)[id]={...existing,...row};saveDemo(demo);return {status:existing?'updated':'saved',item:demoBucket('items',vaultId)[id]}}await setDoc(doc(db,...cpath(vaultId,'items'),id),row,{merge:true});return {status:existing?'updated':'saved',item:{...existing,...row}}},
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
  async uploadImage(vaultId,file,{caption='',tags=[]}={}){const id=uid();if(demoMode){const url=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(file)});const row={id,name:file.name||'image',url,storagePath:'demo',caption,tags,createdAt:nowIso()};demoBucket('images',vaultId)[id]=row;saveDemo(demo);return row}const clean=(file.name||'image').replace(/[^a-z0-9._-]/gi,'_');const path=`users/${currentUser.uid}/vaults/${vaultId}/images/${id}-${clean}`;const sr=storageRef(storage,path);await uploadBytes(sr,file,{contentType:file.type||'application/octet-stream'});const url=await getDownloadURL(sr);const row={id,name:file.name||'image',url,storagePath:path,caption,tags,createdAt:serverTimestamp()};await setDoc(doc(db,...cpath(vaultId,'images'),id),row);return row},
  async importRemoteImage(vaultId,url){if(demoMode)throw new Error('Remote image importing requires Firebase Cloud Functions.');const call=httpsCallable(functions,'importRemoteImage');const r=await call({vaultId,url});return r.data.image},
  async deleteImage(vaultId,image){if(demoMode){delete demoBucket('images',vaultId)[image.id];saveDemo(demo);return}if(image.storagePath){try{await deleteObject(storageRef(storage,image.storagePath))}catch{}}await deleteDoc(doc(db,...cpath(vaultId,'images'),image.id))},
  async fetchMetadata(url){if(demoMode){let title;try{const u=new URL(url);title=u.pathname.split('/').filter(Boolean).pop()?.replace(/[-_]/g,' ')||u.hostname}catch{title='Saved Link'}return {title,source:sourceFromUrl(url),thumbnail:'',embedUrl:'',mediaUrl:'',tags:[],suggestedCategories:[]}}const call=httpsCallable(functions,'fetchPageMetadata');const r=await call({url});return r.data},
  async exportVault(vaultId){const [vaults,categories,items,sessions,notes,images]=await Promise.all([this.listVaults(),this.listCategories(vaultId),this.listItems(vaultId,true),this.listSessions(vaultId),this.listNotes(vaultId),this.listImages(vaultId)]);return {version:1,exportedAt:nowIso(),vault:vaults.find(v=>v.id===vaultId),categories,items,sessions,notes,images}},
  async importVaultData(vaultId,data){for(const c of data.categories||[])await this.saveCategory(vaultId,c);for(const i of data.items||[])await this.saveItem(vaultId,i,{skipIfExists:true});for(const s of data.sessions||[])await this.saveSession(vaultId,s);for(const n of data.notes||[])await this.saveNote(vaultId,n);return true},
  async seedDefaultCategories(vaultId){const existing=await this.listCategories(vaultId);if(existing.length)return;for(const [name,color] of DEFAULT_CATEGORIES)await this.saveCategory(vaultId,{name,color})}
};
