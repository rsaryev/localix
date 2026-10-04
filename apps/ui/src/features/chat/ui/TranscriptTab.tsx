import { useState } from 'react'
import { Import as ImportIcon } from 'lucide-react'
import { useAutoScroll } from '@/shared/hooks/useAutoScroll'
import { useRoutedNavigation } from '@/shared/hooks/useRoutedNavigation'
import { toast } from '@/shared/lib/notify'
import { Button } from '@localixai/kit/button'
import { EmptyHint } from '@localixai/kit/empty-hint'
import { Spinner } from '@localixai/kit/spinner'
import { readTranscript } from '../model/openTranscript'
import { TranscriptView } from './TranscriptView'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'

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
  const [runningAction, setRunningAction] = useState(false)

  if (!transcript) {
    // Content is held in memory only (see openTranscript), so a tab restored after a reload has
    // nothing to show. Saying so beats an empty transcript that reads as an empty conversation.
    return <EmptyHint>Reopen this transcript from where you opened it.</EmptyHint>
  }

  const runAction = async () => {
    if (!transcript.action || runningAction) return
    setRunningAction(true)
    try {
      const destination = await transcript.action.run()
      if (destination) {
        navigation.goToSession(destination.sessionId, { project: destination.projectId })
      }
    } catch (cause) {
      toast.error('Could not import this conversation', {
        description: errorMessage(cause, '') || undefined,
      })
    } finally {
      setRunningAction(false)
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
      {transcript.action && (
        <div
          data-slot="transcript-action-footer"
          // No fill: this footer is a flex sibling of the transcript, so nothing ever
          // scrolls under it — a `bg-background/95` coat only double-coated the pane's
          // ground under glass and read as a darker band.
          className="shrink-0 border-t border-border-soft px-4 py-3"
        >
          <div className="mx-auto flex w-full max-w-(--chat-measure) items-center gap-4">
            {transcript.action.description && (
              <p className="min-w-0 flex-1 truncate text-xs text-text-faint">
                {transcript.action.description}
              </p>
            )}
            <Button
              type="button"
              onClick={() => void runAction()}
              disabled={runningAction}
              aria-label={transcript.action.label}
              className="h-10 shrink-0 gap-2 rounded-xl px-5 shadow-(--shadow-raised)"
            >
              {runningAction ? <Spinner className="size-4" /> : <ImportIcon className="size-4" />}
              {runningAction ? transcript.action.pendingLabel : transcript.action.label}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
