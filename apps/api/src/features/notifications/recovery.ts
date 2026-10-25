import type { Recovery } from '@localixai/agent/agents'
import { localixUiUri, settingsUiUri } from '@localixai/mini-app-sdk/navigation'

import type { InboxAction } from './contracts'

/**
 * WHAT A PERSON CAN DO ABOUT A PROBLEM — one vocabulary for the transcript and the journal.
 *
 * A failure used to say what to do in prose: "Trying again may work.", "sign in from Settings".
 * Prose is an instruction with no control near it, and the two surfaces that report the same
 * failure (a transcript notice and an Event Center row) each grew their own closed list — the
 * notice knew only `retry`, the row only a session link — so a refused key offered a Retry that
 * could not succeed and a condition row offered nothing at all.
 *
 * So recovery is an OPEN SET of typed verbs, each with a parameter where it needs one, and both
 * surfaces render from it:
 *
 *   retry                    re-run the turn (the regenerate path; the host decides it is safe)
 *   open-settings:<tab>[/<anchor>]   a settings section; `providers` is the model picker, where
 *                            provider connections and keys live
 *   open-store:<kind>[/<id>] a Store shelf or page: where plugins, mini apps, MCP servers, skills
 *                            and agents are managed (`kind` is the package kind, `mcp-server`)
 *   sign-in:<connectionId>   a connection whose credential was refused or expired
 *   restart:<subject>        a process the person can restart from its Store page
 *
 * Destinations are built with the SDK's navigation helpers (`@localixai/mini-app-sdk/navigation`),
 * the same ones every tip and `/open` result uses, so a renamed tab breaks here only if it breaks
 * everywhere. Browser-safe: the UI imports this leaf (`@localixai/api/recovery`).
 */

/** The vocabulary's one definition is beside the presenter that emits it (`error-presentation`). */
export type { Recovery }

export type ParsedRecovery =
  | { verb: 'retry' }
  | { verb: 'open-settings'; tab: string; anchor?: string }
  | { verb: 'open-store'; kind: string; id?: string }
  | { verb: 'sign-in'; connectionId: string }
  | { verb: 'restart'; subject: string }

export function parseRecovery(value: string): ParsedRecovery | null {
  if (value === 'retry') return { verb: 'retry' }
  const colon = value.indexOf(':')
  if (colon <= 0) return null
  const verb = value.slice(0, colon)
  const param = value.slice(colon + 1)
  if (!param) return null
  if (verb === 'open-settings') {
    // Split at the FIRST slash only: an anchor names a row, and a row's name may hold one.
    const slash = param.indexOf('/')
    const tab = slash < 0 ? param : param.slice(0, slash)
    const anchor = slash < 0 ? '' : param.slice(slash + 1)
    return tab ? { verb, tab, ...(anchor ? { anchor } : {}) } : null
  }
  if (verb === 'open-store') {
    const slash = param.indexOf('/')
    const kind = slash < 0 ? param : param.slice(0, slash)
    const id = slash < 0 ? '' : param.slice(slash + 1)
    return kind ? { verb, kind, ...(id ? { id } : {}) } : null
  }
  if (verb === 'sign-in') return { verb, connectionId: param }
  if (verb === 'restart') return { verb, subject: param }
  return null
}

/** The Store kind whose page holds a restartable subject's control, by the subject's kind. */
const RESTART_KINDS: Partial<Record<string, string>> = { mcp: 'mcp-server', plugin: 'plugin' }

/** The model picker: provider connections, their keys and their sign-ins live there. */
const PROVIDERS_URI = localixUiUri('picker', ['model'])

const storeUri = (kind: string, id?: string) => localixUiUri('work-item', ['store'], { kind, id })

/** The `localix://` destination a recovery opens; `retry` opens nothing, it runs. */
export function recoveryUri(recovery: ParsedRecovery): string | undefined {
  switch (recovery.verb) {
    case 'retry':
      return undefined
    case 'open-settings':
      return recovery.tab === 'providers'
        ? PROVIDERS_URI
        : settingsUiUri(recovery.tab, recovery.anchor ? { anchor: recovery.anchor } : {})
    case 'open-store':
      return storeUri(recovery.kind, recovery.id)
    case 'sign-in':
      return PROVIDERS_URI
    case 'restart': {
      // The restart control lives on the subject's Store page (`mcp:<name>` → that server); a
      // subject with no page of its own is listed under Diagnostics.
      const [kind = '', ...name] = recovery.subject.split(':')
      const storeKind = RESTART_KINDS[kind]
      return storeKind
        ? storeUri(storeKind, name.join(':') || undefined)
        : settingsUiUri('diagnostics')
    }
  }
}

/** A short imperative label, no full stop. */
export function recoveryLabel(recovery: ParsedRecovery): string {
  switch (recovery.verb) {
    case 'retry':
      return 'Retry'
    case 'open-settings':
      return recovery.tab === 'providers' ? 'Open providers' : 'Open settings'
    case 'open-store':
      return 'Open in the Store'
    case 'sign-in':
      return 'Sign in again'
    case 'restart':
      return 'Restart'
  }
}

/**
 * The journal action for a recovery that NAVIGATES. `retry` is not one: it needs the run it
 * retries, which only the run's producer knows (`producers/runs.ts` `retryAction`).
 */
export function recoveryAction(recovery: Recovery, label?: string): InboxAction {
  const parsed = parseRecovery(recovery)
  if (!parsed || parsed.verb === 'retry') throw new Error(`Not a navigating recovery: ${recovery}`)
  return {
    id: parsed.verb,
    label: label ?? recoveryLabel(parsed),
    kind: 'navigate',
    uri: recoveryUri(parsed),
    available: true,
  }
}
