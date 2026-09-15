export const DEFAULT_CONFIG = {
  apiKey: '',
  projectId: 'nxvlt-d69de',
  ownerUid: 'BVDB5whKhLcRdZyS6TMFRYYnkG82',
  webAppUrl: 'https://nox-vault.github.io/noxvault/',
  decoyUrl: 'https://nox-vault.github.io/noxvault/decoy.html'
};

export async function getRuntimeConfig() {
  const saved = await chrome.storage.local.get('noxConfig');
  return { ...DEFAULT_CONFIG, ...(saved.noxConfig || {}) };
}

export async function saveRuntimeConfig(patch) {
  const current = await getRuntimeConfig();
  const next = { ...current, ...patch };
  await chrome.storage.local.set({ noxConfig: next });
  return next;
}

export function configReady(config) {
  return Boolean(
    config?.apiKey &&
    config?.projectId &&
    config?.ownerUid &&
    !String(config.apiKey).startsWith('PASTE_')
  );
}
