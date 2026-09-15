import { getRuntimeConfig, saveRuntimeConfig } from './config.js';

const ids=['apiKey','projectId','ownerUid','webAppUrl','decoyUrl'];
const config=await getRuntimeConfig();
for(const id of ids)document.getElementById(id).value=config[id]||'';
document.getElementById('config-form').onsubmit=async e=>{
  e.preventDefault();
  const patch={}; for(const id of ids)patch[id]=document.getElementById(id).value.trim();
  await saveRuntimeConfig(patch);
  const s=document.getElementById('status');s.textContent='Saved.';setTimeout(()=>s.textContent='',2200);
};
