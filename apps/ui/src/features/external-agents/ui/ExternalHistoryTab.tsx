import { useWorkItemVisible } from '@localixai/plugin-sdk/ui/visibility'
import type { WorkItem } from '@/features/workspace-grid/model'
import ExternalHistorySidebar from './ExternalHistorySidebar'

/** Container resource links reuse the same history body without another rail entry. */
export default function ExternalHistoryTab({ item }: { item: WorkItem }) {
  const visible = useWorkItemVisible()
  const provider = typeof item.payload?.provider === 'string' ? item.payload.provider : undefined
  const cwd = typeof item.payload?.cwd === 'string' ? item.payload.cwd : undefined
  return (
    <ExternalHistorySidebar
      owningSessionId={null}
      search=""
      enabled={visible}
      scope={{ provider, cwd }}
    />
  )
}
