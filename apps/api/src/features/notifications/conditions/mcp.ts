import { settingsEntityAnchor } from '@localixai/plugin-sdk/navigation'

import { recoveryAction } from '../recovery'
import { createConditions, type ConditionJournal } from './condition'

/**
 * AN MCP SERVER THAT DOES NOT CONNECT, as a standing condition.
 *
 * A failed connect was recorded in the manager's log and skipped, by design — one broken optional
 * server must not stop a turn. The cost was that it failed on every turn, silently: the model simply
 * had fewer tools, and a person learned why only by opening Settings and probing. The manager now
 * reports every connect's outcome here (`client-manager.ts` `observeConnections`).
 *
 * Subject `mcp:<server>:<projectId>:` — a server is its name within one scope ('' is global), so a
 * same-named server that works in another project cannot settle this one. A sign-in challenge is
 * its own problem, worded as the thing to do; any other failure keeps the server's own reason. A
 * successful connect settles the subject.
 */

export interface McpServerIdentity {
  userId: string
  name: string
  projectId: string
}

export interface McpConnectionObserver {
  connected(server: McpServerIdentity): void
  failed(server: McpServerIdentity, error: string, authRequired: boolean): void
}

export function createMcpConditions(journal: ConditionJournal): McpConnectionObserver {
  const conditions = createConditions(journal)
  const subject = (server: McpServerIdentity) => ['mcp', server.name, server.projectId]
  return {
    connected: (server) => conditions.clear(server.userId, subject(server)),
    failed(server, error, authRequired) {
      conditions.raise(server.userId, {
        subject: subject(server),
        problem: authRequired ? 'auth-required' : error,
        severity: authRequired ? 'warning' : 'error',
        title: authRequired
          ? `Sign in to the MCP server “${server.name}”`
          : `Could not connect to the MCP server “${server.name}”`,
        body: authRequired
          ? 'The server asked for authorization. Its tools stay unavailable until you sign in from Settings.'
          : error,
        origin: { kind: 'application', label: server.name },
        // The server's own row in Settings → MCP: where it signs in, restarts and is edited.
        actions: [
          recoveryAction(
            `open-settings:mcp/${settingsEntityAnchor('mcp', server.name)}`,
            authRequired ? 'Sign in' : 'Open MCP settings',
          ),
        ],
      })
    },
  }
}
