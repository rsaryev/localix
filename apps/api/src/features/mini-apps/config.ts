import type { MiniAppConfigValues } from '@localixai/mini-app-sdk/backend'
import type { MiniAppConfigOption } from '@localixai/mini-app-sdk/manifest'

export type { MiniAppConfigValues }

/**
 * A mini app's effective settings: the defaults `mini-app.json` declares, overlaid with what the
 * person stored (which wins). What its backend's `register(ctx)` reads as `ctx.config`.
 */
export function resolveMiniAppConfig(
  declared: Record<string, MiniAppConfigOption> | undefined,
  stored: MiniAppConfigValues | undefined,
): MiniAppConfigValues {
  const out: MiniAppConfigValues = {}
  for (const [key, option] of Object.entries(declared ?? {})) {
    if (option.default !== undefined) out[key] = option.default
  }
  for (const [key, value] of Object.entries(stored ?? {}))
    out[key] = typed(declared?.[key]?.type, value)
  return out
}

/**
 * A stored value as its declared type. The vault holds a secret option as text, so a sensitive
 * number or boolean comes back as `"1234"` or `"false"` (which reads as true); it is turned back.
 */
function typed(type: string | undefined, value: MiniAppConfigValues[string]) {
  if (typeof value !== 'string') return value
  if (type === 'boolean' && (value === 'true' || value === 'false')) return value === 'true'
  if (type === 'number' && value.trim() !== '' && Number.isFinite(Number(value)))
    return Number(value)
  return value
}
