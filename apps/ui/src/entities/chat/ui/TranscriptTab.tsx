import { useRef, useState } from 'react'
import { Import as ImportIcon } from 'lucide-react'
import type { MiniAppTranscriptAction } from '@localixai/mini-app-sdk/ui/runtime'
import { useAutoScroll } from '@/shared/hooks/useAutoScroll'
import { useRoutedNavigation } from '@/shared/hooks/useRoutedNavigation'
import { toast } from '@/shared/lib/notify'
import { Button } from '@localixai/kit/button'
import { EmptyHint } from '@localixai/kit/empty-hint'
import { Spinner } from '@localixai/kit/spinner'
import { readTranscript } from '../model/openTranscript'
import { TranscriptView } from './TranscriptView'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'

/**
 * The `transcript` work item — a conversation someone opened for reading.
 *
 * Read-only by construction: no composer is mounted and no action callback is passed, so there is
 * nothing to send and nothing to edit. The surface itself is the chat's, unchanged.
 */
export function TranscriptTab({
  transcriptId,
  focused,
}: {
  transcriptId: string
  focused: boolean
}) {
  const transcript = readTranscript(transcriptId)
  const scroll = useAutoScroll<HTMLDivElement>(transcriptId, focused)
  const navigation = useRoutedNavigation()
  const [runningAction, setRunningAction] = useState<number | null>(null)
  const inFlight = useRef(false)

  if (!transcript) {
    // Content is held in memory only (see openTranscript), so a tab restored after a reload has
    // nothing to show. Saying so beats an empty transcript that reads as an empty conversation.
    return <EmptyHint>Reopen this transcript from where you opened it.</EmptyHint>
  }

  const actions = transcript.actions ?? (transcript.action ? [transcript.action] : [])
  const description = actions.find((action) => action.description)?.description
  const runAction = async (action: MiniAppTranscriptAction, index: number) => {
    if (inFlight.current) return
    inFlight.current = true
    setRunningAction(index)
    try {
      const destination = await action.run()
      if (destination) {
        navigation.goToSession(destination.sessionId, { project: destination.projectId })
      }
    } catch (cause) {
      toast.error(action.errorLabel ?? 'Could not complete this action', {
        description: errorMessage(cause, '') || undefined,
      })
    } finally {
      inFlight.current = false
      setRunningAction(null)
    }
  }

  // No ground coat: the hosting pane already paints one, and under the macOS glass theme the
  // ground tokens carry alpha — a second pane-sized coat compounds into an opaque slab.
  return (
    <div className="relative flex h-full min-h-0 w-full flex-col text-foreground">
      <TranscriptView
        messages={[...transcript.messages]}
        sessionId={transcript.id}
        isFocused={focused}
        scroll={scroll}
        foreignTools={transcript.foreignTools === true}
        empty={<EmptyHint>No readable turns in this transcript.</EmptyHint>}
      />
      {actions.length > 0 && (
        <div
          data-slot="transcript-action-footer"
          // No fill: this footer is a flex sibling of the transcript, so nothing ever
          // scrolls under it — a `bg-background/95` coat only double-coated the pane's
          // ground under glass and read as a darker band.
          className="shrink-0 border-t border-border-soft px-4 py-2"
        >
          <div className="mx-auto flex w-full max-w-(--chat-measure) flex-wrap items-center gap-2">
            {description && (
              <p className="min-w-0 flex-1 truncate text-xs text-text-faint" title={description}>
                {description}
              </p>
            )}
            <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
              {actions.map((action, index) => {
                const ActionIcon = action.icon ?? ImportIcon
                const pending = runningAction === index
                return (
                  <Button
                    key={action.label}
                    variant="secondary"
                    size="sm"
                    type="button"
                    onClick={() => void runAction(action, index)}
                    disabled={runningAction !== null}
                    aria-busy={pending}
                    aria-label={action.label}
                    className="shrink-0 gap-2"
                  >
                    {pending ? <Spinner size="sm" /> : <ActionIcon />}
                    {pending ? action.pendingLabel : action.label}
                  </Button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
