/**
 * Per-view persisted SCRATCH state for bridged plugin views — the host backing
 * for the `getViewState` / `setViewState` built-in bridge actions. Keyed by the
 * `${plugin}\x00${view}` scope the action table passes, so a view survives a
 * remount (rail toggle, theme snapshot rebuild) and one plugin's state can never
 * be read by another (the scope embeds the plugin name).
 *
 * localStorage-backed (small JSON-serialisable blobs only), fail-soft on every
 * edge — a disabled Storage, a quota-exceeded write, or corrupt JSON degrade to
 * "no saved state" rather than throwing into the bridge dispatch.
 */
import { loadJSON, saveString } from '@localixai/mini-app-sdk/ui/storage'

const PREFIX = 'lx.pluginView:'
/** Reject oversized blobs so a view can't wedge the shared localStorage quota. */
const MAX_BYTES = 64 * 1024

export function readPluginViewState(scope: string): unknown {
  return loadJSON(PREFIX + scope)
}

export function writePluginViewState(scope: string, value: unknown): void {
  const serialized = JSON.stringify(value ?? null)
  if (serialized.length > MAX_BYTES) {
    throw new Error(`View state too large (max ${MAX_BYTES} bytes)`)
  }
  saveString(PREFIX + scope, serialized)
}
