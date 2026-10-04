/** The agent bridge must stay mounted even when no local feedback iframe exists. */
export function shouldMountBrowserHost(desktop: boolean, hasLocalPreviewHosts: boolean): boolean {
  return desktop || hasLocalPreviewHosts
}
