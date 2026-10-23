import { MINI_APP_SURFACE_WORKBENCH } from '@localixai/mini-app-sdk/manifest-primitives'
import { railViewletRegistry } from '@/shared/contrib/uiContrib'
import type { MiniAppDesktopApps } from '@/shared/lib/miniAppDesktopApps'
import {
  createStandaloneApp,
  installedStandaloneApps,
  refreshStandaloneApps,
  removeStandaloneApp,
  standaloneAppsSupported,
  subscribeStandaloneApps,
} from './standaloneApps'

let names: readonly string[] = []
let from: unknown = null

/** The installed apps' mini app names, the same array while the shell's list is unchanged. */
function installedNames(): readonly string[] {
  const apps = installedStandaloneApps()
  if (apps !== from) {
    from = apps
    names = apps.map((app) => app.miniApp)
  }
  return names
}

/**
 * The standalone apps as the store sees them (`shared/lib/miniAppDesktopApps.ts`). Available under
 * the rule the "Install … as App" action follows: the macOS shell, and a screen of the mini app's
 * own — its rail entry once installed, its declared `workbench` surface before.
 */
export const standaloneDesktopApps: MiniAppDesktopApps = {
  available: (miniApp, surfaces) =>
    standaloneAppsSupported &&
    (railViewletRegistry.list().some((viewlet) => viewlet.miniAppName === miniApp) ||
      Boolean(surfaces?.includes(MINI_APP_SURFACE_WORKBENCH))),
  installed: installedNames,
  subscribe: subscribeStandaloneApps,
  refresh: () => void refreshStandaloneApps(),
  install: (miniApp, title) => createStandaloneApp({ miniApp, title }),
  async remove(miniApp) {
    const app = installedStandaloneApps().find((entry) => entry.miniApp === miniApp)
    if (app) await removeStandaloneApp(app)
  },
}
