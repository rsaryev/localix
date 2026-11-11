import {
  autoUpdatePassAllowed as passAllowed,
  marketplaceAutoUpdate,
  toggleDecision,
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

/** The record's `autoUpdate`, else the kit's default for the name (on for Claude Code's official ones). */
export const recordedAutoUpdate = (name: string, recorded: boolean | undefined): boolean =>
  marketplaceAutoUpdate({ name, ...(recorded === undefined ? {} : { recorded }) })

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
