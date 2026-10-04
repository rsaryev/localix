/**
 * The tool-GC report. Its own request rather than a field on the capability snapshot: that
 * document is cached per capability revision, and usage changes constantly without bumping it, so
 * the GC half would go stale behind a revision that claims to be current.
 */

import { cleanQuery, client, unwrap } from './internal'
import type { ToolGcReport } from './contracts'

export const toolsApi = {
  async fetchToolGcReport(opts?: {
    projectId?: string | null
    sessionId?: string | null
  }): Promise<ToolGcReport> {
    return unwrap<ToolGcReport>(
      await client.rpc.tools.gc.$get({
        query: cleanQuery({ projectId: opts?.projectId, sessionId: opts?.sessionId }),
      }),
    )
  },
}
