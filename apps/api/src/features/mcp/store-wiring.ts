import type { Kysely } from 'kysely'
import type { StoreProvider } from '@localixai/store'

import type { AppDatabase } from '../../db'
import { localixWorkspaceDir } from '../../lib/env'
import { claudeCodeHome } from '../cc-settings/config-dir'
import { claudeCodeMcpServers } from './claude-code-servers'
import { createMcpRepository } from './repository'
import type { McpService } from './service'
import { createMcpStoreProvider, type McpStoreDeps } from './store-provider'

/**
 * The MCP servers provider over the MCP service and the rule store, as `bootstrap/` hands it to
 * the Store. `bootstrap/` passes the switches (the rule store) and the changes made anywhere (the
 * capability revision), as it does for skills and agents. Claude Code's files are read as a run
 * reads them (`claude-code-servers.ts`): the person's are the `user` and `managed` scopes read from
 * the workspace, a project's the `local` and `project` scopes read from its folder.
 */
export function mcpStoreProviderOf(deps: {
  db: Kysely<AppDatabase>
  service: McpService
  resolveProjectCwd: (userId: string, projectId: string) => Promise<string | null>
  availability: McpStoreDeps['availability']
  onChange: McpStoreDeps['onChange']
}): StoreProvider {
  const filesIn = (cwd: string, scopes: string[]) =>
    claudeCodeMcpServers({
      own: [],
      plugins: [],
      userId: '',
      projectId: '',
      cwd,
      homeDir: claudeCodeHome(),
    }).filter((server) => scopes.includes(server.id.split(':')[1] ?? ''))
  return createMcpStoreProvider({
    repo: createMcpRepository(deps.db),
    service: deps.service,
    availability: deps.availability,
    files: {
      user: () => filesIn(localixWorkspaceDir(), ['user', 'managed']),
      project: (cwd) => filesIn(cwd, ['local', 'project']),
    },
    projectCwd: deps.resolveProjectCwd,
    onChange: deps.onChange,
  })
}
