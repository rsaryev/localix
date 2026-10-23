import { SourceControlTab } from './source-control/ui/SourceControlTab'

/**
 * Mini-app-owned Git workspace body.
 */
export function GitWorkspace({ sessionId }: { sessionId: string | null }) {
  return <SourceControlTab sessionId={sessionId} />
}
