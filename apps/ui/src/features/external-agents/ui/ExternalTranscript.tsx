import type { WorkItem } from '@/shared/lib/workItem'
import { TranscriptTab } from '@/entities/chat/ui/TranscriptTab'
import { readTranscript } from '@/entities/chat/model/openTranscript'
import { LoadingHint, EmptyHint } from '@localixai/kit/empty-hint'
import useSWR from 'swr'
import { loadExternalSession, prepareExternalTranscript } from '../model/openSession'
import { ExternalSessionBreadcrumb } from './ExternalSessionBreadcrumb'
import { parseLinkKey } from '@localixai/api/external-agent-identity'
import { useRef } from 'react'
import type { ExternalSessionSource } from '../model/sessionResource'

export default function ExternalTranscript({
  item,
  focused,
}: {
  item: WorkItem
  focused: boolean
}) {
  const key = typeof item.payload?.key === 'string' ? item.payload.key : ''
  const id =
    typeof item.payload?.transcriptId === 'string'
      ? item.payload.transcriptId
      : `external-agent:${key}`
  const ready = readTranscript(id)
  const resolvedSource = useRef<ExternalSessionSource | null>(null)
  const query = useSWR(
    !ready && key ? ['external-agent:open', key] : null,
    async () => {
      const source = await loadExternalSession(key)
      await prepareExternalTranscript(source, null)
      resolvedSource.current = source
      return source
    },
    { shouldRetryOnError: false },
  )
  if (query.error)
    return (
      <EmptyHint>This agent session could not be read. Reopen it from External history.</EmptyHint>
    )
  if (!ready && query.isLoading) return <LoadingHint>Reading agent session…</LoadingHint>
  const identity = parseLinkKey(key)
  const source =
    query.data ??
    resolvedSource.current ??
    (identity
      ? {
          key,
          provider: identity.provider,
          title:
            ready?.title ??
            (typeof item.payload?.title === 'string' ? item.payload.title : item.title),
          cwd: typeof item.payload?.cwd === 'string' ? item.payload.cwd : undefined,
        }
      : null)
  return (
    <div className="flex h-full min-h-0 flex-col">
      {source && <ExternalSessionBreadcrumb source={source} />}
      <div className="min-h-0 flex-1">
        <TranscriptTab transcriptId={id} focused={focused} />
      </div>
    </div>
  )
}
