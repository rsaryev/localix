import type { McpProbeResult, McpServerRecord } from '@/shared/api/contracts'
import type { SettingRegistryState } from './settingRegistry'

/**
 * A server row's live connection state: a settled probe, `'loading'` while one is
 * in flight, and `undefined` for a server nothing has probed yet.
 *
 * Named because "not probed" and "probing" are answers, not missing data — the
 * row renders a different status for each, and spelling the union out at every
 * call site is how one of the three quietly gets dropped.
 */
export type McpStatus = McpProbeResult | 'loading'

export function mcpRegistryState(
  enabled: boolean,
  state: McpProbeResult | 'loading' | undefined,
): SettingRegistryState {
  if (!enabled) return 'disabled'
  if (state === 'loading' || state === undefined) return 'warning'
  return state.ok ? 'enabled' : 'error'
}

export function mcpStatusLabel(
  enabled: boolean,
  state: McpProbeResult | 'loading' | undefined,
  toolCount: number | null,
): string {
  if (!enabled) return 'Disabled'
  if (state === 'loading' || state === undefined) return 'Checking'
  if (state.ok) return `Connected · ${toolCount} tool${toolCount === 1 ? '' : 's'}`
  return 'Failed'
}

/**
 * A remote URL is not inherently an OAuth server. Offer Sign in only after its
 * live probe received an explicit auth challenge; public HTTP MCP servers (such
 * as grep.app) remain ordinary connected servers without a dead-end button.
 */
export function shouldShowMcpSignIn(
  server: Pick<McpServerRecord, 'transport' | 'oauthStatus'>,
  state: McpProbeResult | 'loading' | undefined,
): boolean {
  return (
    server.transport === 'http' &&
    server.oauthStatus === 'unauthenticated' &&
    state !== undefined &&
    state !== 'loading' &&
    !state.ok &&
    state.authRequired === true
  )
}
