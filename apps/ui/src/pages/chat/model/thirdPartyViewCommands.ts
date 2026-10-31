import type { PaletteCommand } from '@/shared/contrib/uiCommands'
import { listThirdPartyViews } from '@/shared/contrib/runtimeViews'

/**
 * Build the command-palette entries for mini apps' sandboxed views — the
 * counterpart of the core features' "Open/Show …" commands. Pure over the
 * runtime-views store + injected openers, so it is unit-testable without React:
 * because it reads {@link listThirdPartyViews}, a view that dropped out of the store
 * (disabled/uninstalled mini app) yields no command on the next call — the command
 * disappears exactly like the rail button.
 *
 * Every view Opens its grid tab (the CALLER supplies the same tab id its rail button
 * uses, so re-running focuses rather than duplicating).
 */
interface ThirdPartyViewCommandOpeners {
  /** Open a view as a grid tab. */
  openWorkItem(input: {
    miniAppName: string
    projectId: string
    viewId: string
    fullName: string
    title: string
  }): void
}

export function buildThirdPartyViewCommands(
  openers: ThirdPartyViewCommandOpeners,
): PaletteCommand[] {
  return listThirdPartyViews().map((v): PaletteCommand => ({
    id: `view.mini-app.${v.fullName}`,
    label: `Open ${v.title}`,
    group: 'View',
    effect: 'read',
    keywords: [v.app, 'mini app'],
    run: () =>
      openers.openWorkItem({
        miniAppName: v.app,
        projectId: v.projectId,
        viewId: v.id,
        fullName: v.fullName,
        title: v.title,
      }),
  }))
}
