import { createHash } from 'node:crypto'
import { stableStringify } from '@localixai/agent'
import type { McpServerRecord } from './repository'
import { connectServerConfig } from './expand'

export function mcpConnectionKey(server: McpServerRecord, cwd: string): string {
  const config = connectServerConfig(server, {
    extraEnv: { CLAUDE_PROJECT_DIR: cwd },
  })
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
        ...(server.transport === 'stdio' ? { cwd } : {}),
      }),
    )
    .digest('hex')
}
