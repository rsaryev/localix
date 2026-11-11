import { isRecord } from '../../../../lib/record'
import type { MarketplaceSource } from '@rsaryev/llx-plugin/marketplace'
import {
  createMarketplaceGate,
  createPolicyView,
  pluginBlockedMessage,
  type MarketplaceGate,
} from '@rsaryev/llx-plugin/settings'
import {
  readManagedComposition,
  systemManagedSource,
  type ManagedSettingsSource,
} from '../settings/managed'

/**
 * The organization's plugin policy in this machine's managed settings, judged by the kit: which
 * marketplace sources may be added, refreshed and installed from (`createMarketplaceGate` over
 * `strictKnownMarketplaces` and `blockedMarketplaces`), a plugin `enabledPlugins` turns off, and
 * the marketplaces `extraKnownMarketplaces` declares. A directory names a file-only source.
 */

type Sdk = Parameters<MarketplaceGate['check']>[0]

/** The source as settings write it (`{ source: 'github', repo }`), which the gate reads. */
const written = ({ kind, ...fields }: MarketplaceSource): Sdk =>
  ({ source: kind, ...fields }) as Sdk

const sourceOf = (from: string | ManagedSettingsSource | undefined): ManagedSettingsSource =>
  typeof from === 'string' ? { dir: from } : (from ?? systemManagedSource())

export interface MarketplacePolicy {
  gate: MarketplaceGate
  settings: Record<string, unknown>
}

export async function marketplacePolicy(
  from?: string | ManagedSettingsSource,
): Promise<MarketplacePolicy> {
  const { layer } = await readManagedComposition(sourceOf(from))
  return { gate: createMarketplaceGate(createPolicyView([layer])), settings: layer.settings }
}

/** Throw the policy's refusal when managed settings do not admit the source. */
export async function assertMarketplaceAllowed(
  source: MarketplaceSource,
  from?: string | ManagedSettingsSource,
): Promise<void> {
  const verdict = (await marketplacePolicy(from)).gate.check(written(source))
  if (!verdict.allowed) throw new Error(verdict.message)
}

/** Throw when managed `enabledPlugins` turns the plugin off: it cannot be installed. */
export async function assertPluginAllowed(
  id: string,
  from?: string | ManagedSettingsSource,
): Promise<void> {
  const { enabledPlugins } = (await marketplacePolicy(from)).settings
  if (isRecord(enabledPlugins) && enabledPlugins[id] === false)
    throw new Error(pluginBlockedMessage(id, { kind: 'plugin', action: 'install' }))
}

/** The `extraKnownMarketplaces` entries of managed settings, as written. */
export async function managedDeclarations(
  from?: string | ManagedSettingsSource,
): Promise<Record<string, unknown>> {
  const { extraKnownMarketplaces } = (await marketplacePolicy(from)).settings
  return isRecord(extraKnownMarketplaces) ? { ...extraKnownMarketplaces } : {}
}
