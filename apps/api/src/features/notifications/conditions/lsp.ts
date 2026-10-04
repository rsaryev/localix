import { recoveryAction } from '../recovery'
import { createConditions, type ConditionJournal } from './condition'

/**
 * A LANGUAGE SERVER THAT CRASHED OR NEVER STARTED, as a standing condition.
 *
 * The manager drops a crashed server and starts it again on the next file touch, which is right —
 * and was silent: diagnostics simply stopped arriving, and the agent's edits went unchecked with
 * nothing to say why. A `warning`, not an `error`: everything still works, only the checking does
 * not — degraded, which is what a warning means for every condition. It was `info`, the one
 * condition below the line every other producer draws, so it never interrupted and read as news
 * rather than as something to fix. A server that is not installed is NOT reported; that is a
 * choice, not a failure.
 *
 * Subject `lsp:<serverId>:<rootDir>:` — one server per project root. It settles when that server
 * reports ready again.
 */

export interface LspServerIdentity {
  serverId: string
  serverName: string
  rootDir: string
}

export interface LspHealthObserver {
  ready(server: LspServerIdentity): void
  failed(server: LspServerIdentity, phase: 'start' | 'crash'): void
}

/** Language servers are process-wide; their rows belong to the default user. */
export function createLspConditions(journal: ConditionJournal, userId: string): LspHealthObserver {
  const conditions = createConditions(journal)
  const subject = (server: LspServerIdentity) => ['lsp', server.serverId, server.rootDir]
  return {
    ready: (server) => conditions.clear(userId, subject(server)),
    failed(server, phase) {
      conditions.raise(userId, {
        subject: subject(server),
        problem: phase,
        severity: 'warning',
        title:
          phase === 'start'
            ? `Could not start the ${server.serverName} language server`
            : `The ${server.serverName} language server stopped`,
        body: `Diagnostics for ${server.rootDir} are unavailable until it runs again. It restarts on the next edit.`,
        origin: { kind: 'application', label: `${server.serverName} language server` },
        // Diagnostics lists the language servers and what each one is doing.
        actions: [recoveryAction('open-settings:diagnostics', 'Open diagnostics')],
      })
    },
  }
}
