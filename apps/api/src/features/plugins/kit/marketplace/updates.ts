import {
  autoUpdatePassAllowed as passAllowed,
  planUpdate,
  pluginSkippedByAutoUpdate,
  toggleDecision,
  type MarketplaceEntry,
  type SkippedBy,
} from '@rsaryev/llx-plugin/marketplace'
import { processEnvironment } from '../ports/host-io'

/**
 * Who auto-updates, judged by the kit (plugins/loading.md, "Which marketplaces and plugins
 * auto-update"): whether the background pass runs at all under the update variables, whether a
 * marketplace auto-updates by the `autoUpdate` on its record, else the default for its name, and
 * whether the person may flip the Marketplaces toggle.
 */

type Env = Record<string, string | undefined>

export const autoUpdatePassAllowed = (env: Env): boolean =>
  passAllowed(processEnvironment(() => env))

export type ToggleRefusal = { reason: 'paused' } | { reason: 'managed'; message: string }

/**
 * Why the toggle may not be flipped, or `undefined`: the whole pass is off (the toggle is hidden),
 * or the organization's managed `extraKnownMarketplaces` entry sets `autoUpdate`.
 */
export function autoUpdateToggleRefusal(input: {
  name: string
  enable: boolean
  env: Env
  managedAutoUpdate: boolean | undefined
}): ToggleRefusal | undefined {
  const { managedAutoUpdate } = input
  const decision = toggleDecision({
    name: input.name,
    enable: input.enable,
    env: processEnvironment(() => input.env),
    ...(managedAutoUpdate === undefined
      ? {}
      : { declared: { scope: 'managed', autoUpdate: managedAutoUpdate } }),
  })
  if (decision.outcome === 'hidden') return { reason: 'paused' }
  if (decision.outcome === 'refused') return { reason: 'managed', message: decision.issue.message }
  return undefined
}

/** Localix never runs a `command` source (`entry-source.ts`), so none was ever accepted. */
const commandSourceOf = (entry: MarketplaceEntry) =>
  entry.source.kind === 'command' ? { commandSource: { accepted: false } } : {}

const headersHelperOf = (entry: MarketplaceEntry) =>
  entry.headersHelper === undefined ? {} : { headersHelper: entry.headersHelper }

/**
 * Why an update check leaves the entry's plugin to the person, or `undefined` (the kit's
 * `pluginSkippedByAutoUpdate`; plugins/loading.md, "Which marketplaces and plugins auto-update"): a
 * `headersHelper` entry, or a `command` source.
 */
export function updateSkipOf(entry: MarketplaceEntry): SkippedBy | undefined {
  const skip = pluginSkippedByAutoUpdate({ ...headersHelperOf(entry), ...commandSourceOf(entry) })
  return skip.skipped ? skip.reason : undefined
}

/**
 * The names of `marketplace`'s entries that "Update marketplace" leaves to the person (the kit's
 * `planUpdate`, `marketplace-tab`; plugins/install.md, "Update plugins now").
 */
export function leftByMarketplaceUpdate(
  marketplace: string,
  entries: readonly MarketplaceEntry[],
): Set<string> {
  const installed = entries.map((entry) => ({
    id: `${entry.name}@${marketplace}`,
    marketplace,
    ...headersHelperOf(entry),
    ...(entry.source.kind === 'command' ? { commandSource: true } : {}),
  }))
  const plan = planUpdate({ kind: 'marketplace-tab', marketplace }, installed, [marketplace])
  return new Set(plan.leftToUser.map((left) => left.id.slice(0, left.id.lastIndexOf('@'))))
}
