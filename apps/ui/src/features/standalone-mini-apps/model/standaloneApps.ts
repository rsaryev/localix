import { useEffect, useSyncExternalStore } from 'react'
import { IS_MAC, isDesktop } from '@localixai/kit/environment'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { tauriInvoke } from '@/shared/lib/tauri'
import { toast } from '@/shared/lib/notify'
import { ensureStandaloneAppProject } from '@/shared/lib/standaloneAppProject'
import type { IconComponent } from './appIcon'

/**
 * Mini apps installed as their own Mac apps. The shell owns the bundles
 * (`apps/desktop-tauri/src-tauri/src/app_bundle.rs`) and they are the only record, so this list is
 * read back from it: after an install, a removal, or the window regaining focus (a bundle can be
 * deleted in Finder at any time).
 */
export interface InstalledStandaloneApp {
  miniApp: string
  name: string
  path: string
  /** The app's project folder; null for a bundle made before apps had projects. */
  projectDir: string | null
}

export interface StandaloneAppSource {
  miniApp: string
  title: string
  Icon: IconComponent
}

/** Only the macOS desktop shell can make an app bundle. */
export const standaloneAppsSupported = isDesktop && IS_MAC

let installed: readonly InstalledStandaloneApp[] = []
const listeners = new Set<() => void>()

function publish(next: readonly InstalledStandaloneApp[]) {
  installed = next
  for (const listener of listeners) listener()
}

export async function refreshStandaloneApps(): Promise<void> {
  const invoke = tauriInvoke()
  if (!standaloneAppsSupported || !invoke) return
  try {
    const list = await invoke('mini_app_apps')
    if (Array.isArray(list)) publish(list as InstalledStandaloneApp[])
  } catch (error) {
    console.warn('[standalone-apps] could not list installed apps', error)
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The installed apps, kept current while any surface shows them. */
export function useInstalledStandaloneApps(): readonly InstalledStandaloneApp[] {
  useEffect(() => {
    if (!standaloneAppsSupported) return
    void refreshStandaloneApps()
    const onFocus = () => void refreshStandaloneApps()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])
  return useSyncExternalStore(subscribe, () => installed)
}

/** Make the mini app its own app, then open it. The shell signs and registers the bundle. */
export async function installStandaloneApp(source: StandaloneAppSource): Promise<void> {
  const invoke = tauriInvoke()
  if (!invoke) return
  try {
    // Drawn only here, so the renderer it needs stays out of the workspace's startup.
    const { renderAppIcon } = await import('./appIcon')
    const icons = await renderAppIcon(source.Icon)
    const installed = (await invoke('mini_app_install', {
      request: { miniApp: source.miniApp, name: source.title, icons },
    })) as InstalledStandaloneApp
    // The app opens into a project of its own: make it now, before the app's first launch.
    if (installed.projectDir) await ensureStandaloneAppProject(installed.projectDir, source.title)
    await invoke('mini_app_open', { miniApp: source.miniApp })
    toast.success(`${source.title} is now an app`, {
      description: 'Find it in Applications, Launchpad and Spotlight, or keep it in the Dock.',
    })
  } catch (error) {
    toast.error(`Could not make ${source.title} an app`, {
      description: errorMessage(error, '') || undefined,
    })
  } finally {
    await refreshStandaloneApps()
  }
}

export async function openStandaloneApp(app: InstalledStandaloneApp): Promise<void> {
  try {
    await tauriInvoke()?.('mini_app_open', { miniApp: app.miniApp })
  } catch (error) {
    toast.error(`Could not open ${app.name}`, { description: errorMessage(error, '') || undefined })
  }
}

export async function removeStandaloneApp(app: InstalledStandaloneApp): Promise<void> {
  try {
    await tauriInvoke()?.('mini_app_uninstall', { miniApp: app.miniApp })
    toast.success(`${app.name} app moved to the Trash`, {
      description: 'The mini app stays in Localix.',
    })
  } catch (error) {
    toast.error(`Could not remove ${app.name}`, {
      description: errorMessage(error, '') || undefined,
    })
  } finally {
    await refreshStandaloneApps()
  }
}

/** The menu rows a mini app shows for its app: install it, or open and remove the one it has. */
export function standaloneAppActions(
  source: StandaloneAppSource,
  apps: readonly InstalledStandaloneApp[],
): { id: string; label: string; run: () => void }[] {
  if (!standaloneAppsSupported) return []
  const app = apps.find((entry) => entry.miniApp === source.miniApp)
  if (!app) {
    return [
      {
        id: `standalone-app.install.${source.miniApp}`,
        label: `Install ${source.title} as App`,
        run: () => void installStandaloneApp(source),
      },
    ]
  }
  return [
    {
      id: `standalone-app.open.${source.miniApp}`,
      label: `Open ${app.name} App`,
      run: () => void openStandaloneApp(app),
    },
    {
      id: `standalone-app.remove.${source.miniApp}`,
      label: `Remove ${app.name} App`,
      run: () => void removeStandaloneApp(app),
    },
  ]
}
