import type { PaletteCommand } from './uiCommands'
import { listThirdPartyViews } from './runtimeViews'

/**
 * Build the command-palette entries for INSTALLED third-party plugin views — the
 * counterpart of the bundled-subsystem "Open/Show …" commands. Pure over the
 * runtime-views store + injected openers, so it is unit-testable without React:
 * because it reads {@link listThirdPartyViews}, a view that dropped out of the store
 * (disabled/uninstalled plugin) yields no command on the next call — the command
 * disappears exactly like the rail button.
 *
 * Every view Opens its grid tab (the CALLER supplies the same tab id its rail button
 * uses, so re-running focuses rather than duplicating).
 */
export interface ThirdPartyViewCommandOpeners {
  /** Open a view as a grid tab. */
  openWorkItem(input: {
    pluginName: string
    projectId: string
    viewId: string
    fullName: string
    title: string
  }): void
}

export function buildThirdPartyViewCommands(
  openers: ThirdPartyViewCommandOpeners,
): PaletteCommand[] {
  return listThirdPartyViews().map(
    (v): PaletteCommand => ({
      id: `view.plugin.${v.fullName}`,
      label: `Open ${v.title}`,
      group: 'View',
      effect: 'read',
      keywords: [v.pluginName, 'plugin'],
      run: () =>
        openers.openWorkItem({
          pluginName: v.pluginName,
          projectId: v.projectId,
          viewId: v.id,
          fullName: v.fullName,
          title: v.title,
        }),
    }),
  )
}
