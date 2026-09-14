export const DEFAULT_CATEGORIES=[
  ['Favorites','#ffd052'],['Watch Later','#5e8dff'],['Soft','#58c8ff'],['Hardcore','#ff5d7d'],['Oral','#a577ff'],['Masturbation','#6a6dff'],['Solo','#4fd5a5'],['Couples','#ff78bc'],['Amateur','#ff9b55'],['Professional','#55b7ff'],['Anal','#e06dff'],['Other','#8aa1c4']
];
export const $=(s,root=document)=>root.querySelector(s);export const $$=(s,root=document)=>[...root.querySelectorAll(s)];
export const uid=()=>crypto.randomUUID();
export const nowIso=()=>new Date().toISOString();
export const esc=(s='')=>String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
export const fmtDate=(v,short=false)=>{if(!v)return '—';const d=v?.toDate?v.toDate():new Date(v);if(Number.isNaN(d.getTime()))return '—';return short?d.toLocaleDateString([], {month:'short',day:'numeric'}):d.toLocaleString([], {month:'short',day:'numeric',year:'numeric',hour:'2-digit',minute:'2-digit'});};
export const timeAgo=v=>{if(!v)return 'Never';const d=v?.toDate?v.toDate():new Date(v),s=Math.max(0,(Date.now()-d.getTime())/1000);if(s<60)return 'Just now';if(s<3600)return `${Math.floor(s/60)} min ago`;if(s<86400)return `${Math.floor(s/3600)}h ago`;if(s<604800)return `${Math.floor(s/86400)}d ago`;return fmtDate(d,true)};
export function normalizeUrl(raw){try{const u=new URL(raw.trim());u.hash='';['utm_source','utm_medium','utm_campaign','utm_term','utm_content','ref','referrer','fbclid','gclid'].forEach(k=>u.searchParams.delete(k));u.hostname=u.hostname.toLowerCase().replace(/^www\./,'');if(u.pathname.length>1)u.pathname=u.pathname.replace(/\/$/,'');[...u.searchParams.keys()].sort().forEach(()=>{});return u.toString();}catch{return raw.trim();}}
export async function sha256(text){const data=new TextEncoder().encode(text);const hash=await crypto.subtle.digest('SHA-256',data);return [...new Uint8Array(hash)].map(b=>b.toString(16).padStart(2,'0')).join('');}
export const sourceFromUrl=raw=>{try{return new URL(raw).hostname.replace(/^www\./,'');}catch{return 'link';}};
export const isDirectVideo=u=>/\.(mp4|webm|ogg)(\?|$)/i.test(u||'');
export const isHls=u=>/\.m3u8(\?|$)/i.test(u||'');
export function parseTags(str=''){return [...new Set(str.split(/[,\n]/).map(s=>s.trim()).filter(Boolean))].slice(0,40)}
export function initials(s=''){return s.trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase()||'NV'}
export function shortcutMatches(e,shortcut){const p=shortcut.toLowerCase().split('+').map(x=>x.trim());const key=e.code==='Space'?'space':e.key.toLowerCase();return (!!e.ctrlKey===p.includes('ctrl'))&&(!!e.shiftKey===p.includes('shift'))&&(!!e.altKey===p.includes('alt'))&&(!!e.metaKey===p.includes('meta'))&&p.includes(key)}
export function prettyShortcut(s){return s.split('+').map(x=>x.trim()).join(' + ')}
export function safeJsonParse(s,fallback=null){try{return JSON.parse(s)}catch{return fallback}}
export function downloadBlob(name,blob){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.append(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},500)}
export function pickFile({accept='*/*',capture=false,multiple=false}={}){return new Promise(resolve=>{const i=document.createElement('input');i.type='file';i.accept=accept;i.multiple=multiple;if(capture)i.setAttribute('capture','environment');i.onchange=()=>resolve(multiple?[...i.files]:i.files[0]||null);i.click();});}
export const sortBy=(arr,key,desc=true)=>[...arr].sort((a,b)=>{const av=a[key]?.toDate?.()?.getTime?.()??new Date(a[key]||0).getTime()||a[key]||0;const bv=b[key]?.toDate?.()?.getTime?.()??new Date(b[key]||0).getTime()||b[key]||0;return desc?(bv>av?1:-1):(av>bv?1:-1)});
export function randomSubset(arr){return [...arr].sort(()=>Math.random()-.5)}
