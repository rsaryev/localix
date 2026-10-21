import { useRef, useState } from 'react'
import type { RosterRow } from '@localixai/api/external-agent-contracts'
import type { UiSession } from '@/shared/api/contracts'
import { WorkbenchListRow, WorkbenchListRowTrigger } from '@localixai/kit/workbench-list-row'
import {
  SessionRowContent,
  SessionRowTimestamp,
  SESSION_ROW_HEIGHT_CLASS,
} from '@/entities/chat/ui/SessionRowContent'
import { externalAgentsApi } from '../api'
import { useChatStore } from '@/entities/chat/model/store'
import { openOwnedExternalSession } from '../model/createSession'
import { toast } from '@/shared/lib/notify'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'

export function NativeSessionRow({
  session,
  source,
  onSelect,
}: {
  session: UiSession
  source: RosterRow
  onSelect: (id: string, options?: { project?: string }) => void | Promise<void>
}) {
  const [opening, setOpening] = useState(false)
  const inFlight = useRef(false)
  const open = async () => {
    if (inFlight.current) return
    inFlight.current = true
    setOpening(true)
    try {
      const destination = await externalAgentsApi.attachNative(source.key, session.projectId)
      await useChatStore.getState().loadProjects()
      await onSelect(destination.sessionId, { project: destination.projectId })
      await openOwnedExternalSession(destination.sessionId)
    } catch (cause) {
      toast.error('Could not open this agent conversation', {
        description: errorMessage(cause, '') || undefined,
      })
    } finally {
      inFlight.current = false
      setOpening(false)
    }
  }
  return (
    <WorkbenchListRow density="compact" className={SESSION_ROW_HEIGHT_CLASS}>
      <WorkbenchListRowTrigger
        data-session-row={session.id}
        aria-label={session.title}
        aria-busy={opening}
        disabled={opening}
        onClick={() => void open()}
      >
        <span aria-hidden="true" className="mr-0.5 size-4 shrink-0" />
        <SessionRowContent session={session} title={session.title} isActive={false} />
        <SessionRowTimestamp session={session} />
        <span aria-hidden="true" className="w-3 shrink-0" />
      </WorkbenchListRowTrigger>
    </WorkbenchListRow>
  )
}
