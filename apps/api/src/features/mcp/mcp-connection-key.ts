import { createHash } from 'node:crypto'
import { stableStringify } from '@localixai/agent'
import type { McpServerRecord } from './repository'
import { folderSettingsEnv, mcpLaunch } from './mcp-settings-env'

export function mcpConnectionKey(server: McpServerRecord, cwd: string): string {
  const settingsEnv = folderSettingsEnv(cwd)
  const { config } = mcpLaunch(server, cwd, settingsEnv)
  return createHash('sha256')
    .update(
      stableStringify({
        id: server.id,
        userId: server.userId,
        projectId: server.projectId,
        name: server.name,
        transport: server.transport,
        config,
        // cwd changes stdio process behavior even when the config itself has
        // no CLAUDE_PROJECT_DIR token. Remote transports are cwd-independent
        // after expansion, so a global HTTP probe can warm every session that
        // uses the same record.
        // The folder's Claude Code settings `env` reaches a stdio server's process: a change there
        // is a different process.
        ...(server.transport === 'stdio' ? { cwd, settingsEnv } : {}),
      }),
    )
    .digest('hex')
}
