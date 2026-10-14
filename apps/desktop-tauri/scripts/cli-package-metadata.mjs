export function buildStagedCliPackageMetadata(tauriConfig) {
  const version = tauriConfig?.version
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u.test(version)) {
    throw new Error('Tauri config must contain a semantic version for the staged CLI')
  }
  return {
    name: 'localix-desktop-cli',
    private: true,
    version,
    type: 'module',
  }
}
