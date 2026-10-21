import { useEffect, useSyncExternalStore } from 'react'
import { IS_MAC, isDesktop } from '@localixai/kit/environment'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { tauriInvoke } from '@/shared/lib/tauri'
import { toast } from '@/shared/lib/notify'
import { ensurePluginAppProject } from '@/shared/lib/pluginAppProject'
import type { IconComponent } from './appIcon'

/**
 * Plugins installed as their own Mac apps. The shell owns the bundles
 * (`apps/desktop-tauri/src-tauri/src/app_bundle.rs`) and they are the only record, so this list is
 * read back from it: after an install, a removal, or the window regaining focus (a bundle can be
 * deleted in Finder at any time).
 */
export interface InstalledPluginApp {
  plugin: string
  name: string
  path: string
  /** The app's project folder; null for a bundle made before apps had projects. */
  projectDir: string | null
}

export interface PluginAppSource {
  plugin: string
  title: string
  Icon: IconComponent
}

/** Only the macOS desktop shell can make an app bundle. */
export const pluginAppsSupported = isDesktop && IS_MAC

let installed: readonly InstalledPluginApp[] = []
const listeners = new Set<() => void>()

function publish(next: readonly InstalledPluginApp[]) {
  installed = next
  for (const listener of listeners) listener()
}

export async function refreshPluginApps(): Promise<void> {
  const invoke = tauriInvoke()
  if (!pluginAppsSupported || !invoke) return
  try {
    const list = await invoke('plugin_apps')
    if (Array.isArray(list)) publish(list as InstalledPluginApp[])
  } catch (error) {
    console.warn('[plugin-apps] could not list installed apps', error)
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The installed apps, kept current while any surface shows them. */
export function useInstalledPluginApps(): readonly InstalledPluginApp[] {
  useEffect(() => {
    if (!pluginAppsSupported) return
    void refreshPluginApps()
    const onFocus = () => void refreshPluginApps()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])
  return useSyncExternalStore(subscribe, () => installed)
}

/** Make the plugin its own app, then open it. The shell signs and registers the bundle. */
export async function installPluginApp(source: PluginAppSource): Promise<void> {
  const invoke = tauriInvoke()
  if (!invoke) return
  try {
    // Drawn only here, so the renderer it needs stays out of the workspace's startup.
    const { renderAppIcon } = await import('./appIcon')
    const icons = await renderAppIcon(source.Icon)
    const installed = (await invoke('plugin_app_install', {
      request: { plugin: source.plugin, name: source.title, icons },
    })) as InstalledPluginApp
    // The app opens into a project of its own: make it now, before the app's first launch.
    if (installed.projectDir) await ensurePluginAppProject(installed.projectDir, source.title)
    await invoke('plugin_app_open', { plugin: source.plugin })
    toast.success(`${source.title} is now an app`, {
      description: 'Find it in Applications, Launchpad and Spotlight, or keep it in the Dock.',
    })
  } catch (error) {
    toast.error(`Could not make ${source.title} an app`, {
      description: errorMessage(error, '') || undefined,
    })
  } finally {
    await refreshPluginApps()
  }
}

export async function openPluginApp(app: InstalledPluginApp): Promise<void> {
  try {
    await tauriInvoke()?.('plugin_app_open', { plugin: app.plugin })
  } catch (error) {
    toast.error(`Could not open ${app.name}`, { description: errorMessage(error, '') || undefined })
  }
}

export async function removePluginApp(app: InstalledPluginApp): Promise<void> {
  try {
    await tauriInvoke()?.('plugin_app_uninstall', { plugin: app.plugin })
    toast.success(`${app.name} app moved to the Trash`, {
      description: 'The plugin stays in Localix.',
    })
  } catch (error) {
    toast.error(`Could not remove ${app.name}`, {
      description: errorMessage(error, '') || undefined,
    })
  } finally {
    await refreshPluginApps()
  }
}

/** The menu rows a plugin shows for its app: install it, or open and remove the one it has. */
export function pluginAppActions(
  source: PluginAppSource,
  apps: readonly InstalledPluginApp[],
): { id: string; label: string; run: () => void }[] {
  if (!pluginAppsSupported) return []
  const app = apps.find((entry) => entry.plugin === source.plugin)
  if (!app) {
    return [
      {
        id: `plugin-app.install.${source.plugin}`,
        label: `Install ${source.title} as App`,
        run: () => void installPluginApp(source),
      },
    ]
  }
  return [
    {
      id: `plugin-app.open.${source.plugin}`,
      label: `Open ${app.name} App`,
      run: () => void openPluginApp(app),
    },
    {
      id: `plugin-app.remove.${source.plugin}`,
      label: `Remove ${app.name} App`,
      run: () => void removePluginApp(app),
    },
  ]
}
