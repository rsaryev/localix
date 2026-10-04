import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { pluginLabel } from '@localixai/plugin-sdk/manifest'
import { backendClient } from '@/shared/api/client'
import type { PluginRecord } from '@/shared/api/contracts'
import { trackCapabilityWrite } from '@/shared/contrib/capabilityWrites'
import { refetchActivePluginContrib } from '@/shared/contrib/enabledPlugins'
import { requestConfirmation } from '@/shared/lib/confirmAction'
import { toast } from '@/shared/lib/notify'

/**
 * Whether the launcher may offer to uninstall `plugin`.
 *
 * A bundled plugin is a shared managed artifact projected into every scope: the server
 * deletes only its state row and leaves the code, so it comes straight back. Settings hides
 * Remove for it for the same reason.
 */
export const canUninstallPlugin = (plugin: PluginRecord): boolean => !plugin.bundled

export interface RemovePluginDeps {
  /** Replaces the server request; omitted, the real client removes the plugin. */
  remove?: (name: string, opts: { projectId: string | null }) => Promise<void>
  /** Re-reads the live enabled set, so the launcher, the rail and open views drop it. */
  refetch: () => Promise<unknown>
  notify: Pick<typeof toast, 'success' | 'error'>
}

const defaultDeps: RemovePluginDeps = {
  refetch: refetchActivePluginContrib,
  notify: toast,
}

/**
 * Remove one installed plugin from the launcher — asked first, since its folder is deleted.
 */
export function uninstallPlugin(plugin: PluginRecord): void {
  const label = pluginLabel(plugin)
  requestConfirmation({
    kind: 'uninstall-plugin',
    title: `Uninstall ${label}?`,
    detail: `Deletes ${plugin.dir} and closes its views. Reinstalling needs its source again.`,
    confirmLabel: 'Uninstall',
    variant: 'destructive',
    perform: () => void removePlugin(plugin),
  })
}

/**
 * The removal itself: the same request Settings → Plugins → Remove makes, through the same
 * write barrier, so a run starting meanwhile waits for it instead of assembling with the old
 * tools. Reports the outcome as a toast and resolves to whether it worked; never throws.
 */
export async function removePlugin(
  plugin: PluginRecord,
  deps: RemovePluginDeps = defaultDeps,
): Promise<boolean> {
  const label = pluginLabel(plugin)
  const projectId = plugin.projectId || null
  try {
    await trackCapabilityWrite(projectId, async () => {
      if (deps.remove) await deps.remove(plugin.name, { projectId })
      else await backendClient.removePlugin(plugin.name, { projectId })
      await deps.refetch()
    })
    deps.notify.success(`${label} uninstalled`)
    return true
  } catch (error) {
    deps.notify.error(`Could not uninstall ${label}`, {
      description: errorMessage(error, '') || undefined,
    })
    return false
  }
}
