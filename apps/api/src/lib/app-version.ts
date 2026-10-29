declare const __LOCALIX_VERSION__: string | undefined

/**
 * The Localix release this API belongs to: written into the desktop bundle at staging
 * (`apps/desktop-tauri/scripts/prepare-sidecar.mjs`, from the stamped `tauri.conf.json`). A run
 * from source belongs to no release and has none.
 */
export function localixVersion(): string | undefined {
  return typeof __LOCALIX_VERSION__ === 'string' ? __LOCALIX_VERSION__ : undefined
}
