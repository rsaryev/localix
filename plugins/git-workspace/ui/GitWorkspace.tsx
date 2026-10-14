import { SourceControlTab } from './source-control/ui/SourceControlTab'

/**
 * Plugin-owned Git workspace body.
 */
export function GitWorkspace({ sessionId }: { sessionId: string | null }) {
  return <SourceControlTab sessionId={sessionId} />
}
