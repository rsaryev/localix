import { useCallback, useEffect, useState } from 'react'
import { FileWarning } from 'lucide-react'
import { snippetMessageBindingDraft, type PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import { miniAppWorkspace } from '@localixai/mini-app-sdk/ui/runtime'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { Button } from '@localixai/kit/button'
import { CanvasProvider } from '@localixai/kit/canvas'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { WorkbenchNoticeBar } from '@localixai/kit/workbench-notice-bar'
import { describeSpace } from '../shared/agent/describe'
import { BOARD_FILE } from '../shared/resource'
import { spaceTypes } from '../shared/types'
import { SpaceBoard } from './board/SpaceBoard'
import { useSpace } from './useSpace'
import './space.css'
import './space-text.css'
import './reading.css'

/**
 * The Project Space tab: the project's board — an empty one is just the empty ground — and what
 * is wrong with its file.
 *
 * What the person selects on the board is published as the chat's context — the same roster
 * lines the agent's `space_read` gives — so "make these three a flow" needs no ids typed out.
 * A file problem is shown above the board with the way to it; the board still draws everything
 * it can read.
 */

export function SpaceWorkspace({
  publishMessageContext,
}: {
  publishMessageContext?: PublishMessageContext
}) {
  const sessionId = useWorkItemSessionId()
  const state = useSpace(sessionId)
  const [selection, setSelection] = useState<readonly string[]>([])
  const view = state.view
  // The same ids are the same selection: a new array for them must not re-publish the context.
  const onSelection = useCallback(
    (ids: readonly string[]) =>
      setSelection((current) =>
        current.length === ids.length && current.every((id, index) => id === ids[index])
          ? current
          : ids,
      ),
    [],
  )

  useEffect(() => {
    if (!publishMessageContext) return
    const ids = selection.filter((id) => view?.space.elements[id])
    if (!view || ids.length === 0) return publishMessageContext(null)
    publishMessageContext({
      strategy: 'append',
      bindings: [
        snippetMessageBindingDraft({
          label: `${ids.length} selected on the board`,
          content: describeSpace(view.space, spaceTypes, { ids, missing: new Set(view.missing) }),
          language: 'text',
        }),
      ],
    })
  }, [publishMessageContext, selection, view])

  if (!sessionId)
    return (
      <EmptyHint>Open Project Space from a chat: the board is that chat’s project’s.</EmptyHint>
    )
  if (!view)
    return state.error ? (
      <EmptyHint>{state.error}</EmptyHint>
    ) : (
      <LoadingHint>Opening the board…</LoadingHint>
    )

  const openFile = () => miniAppWorkspace.openFile({ sessionId, path: BOARD_FILE })
  return (
    <CanvasProvider>
      <div className="flex h-full min-h-0 flex-col">
        {(!view.writable || view.issues.length > 0) && (
          <WorkbenchNoticeBar
            tone={view.writable ? 'warning' : 'error'}
            icon={<FileWarning className="size-3.5" />}
            title={
              view.writable
                ? `${view.issues.length} part${view.issues.length === 1 ? '' : 's'} of the board file could not be read; ${view.issues.length === 1 ? 'it is' : 'they are'} kept as written.`
                : 'The board file cannot be read, so nothing is saved until it is repaired.'
            }
            description={view.issues
              .slice(0, 3)
              .map((issue) => `${issue.path || 'file'}: ${issue.message}`)
              .join('\n')}
            actions={
              <Button size="xs" variant="ghost" onClick={openFile}>
                Open the board file
              </Button>
            }
          />
        )}
        <div className="relative min-h-0 flex-1">
          <SpaceBoard
            view={view}
            sessionId={sessionId}
            apply={(ops) => void state.apply(ops)}
            undo={state.undo}
            redo={state.redo}
            onSelection={onSelection}
            remote={state.remote}
          />
        </div>
      </div>
    </CanvasProvider>
  )
}
