/**
 * A blocked request from a chat the person is not in, answered without going there.
 *
 * It renders the EXACT in-chat `ChatInteractionOverlay` (lazily — no request, no renderer on the
 * startup path) inside the shared `DialogContent`, so answering a background request looks and
 * behaves the same as answering it in place. A thin eyebrow names the waiting chat and links into
 * it. The request comes from the server's attention roster rather than from a stream frame, so it
 * is still here after a reload; a payload this client cannot render falls back to "Open chat".
 */
import { lazy, Suspense, useMemo, useRef, useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { DialogContent, DialogHeader, DialogTitle } from '@localixai/kit/dialog'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'

import { fromHitlRequest } from '@/entities/chat/model/hitlInteraction'
import { ApiError, backendClient } from '@/shared/api/client'
import { toast } from '@/shared/lib/notify'
import type { AttentionBodyProps } from './types'

const ChatInteractionOverlay = lazy(() =>
  import('../hitl/ChatInteractionOverlay').then((module) => ({
    default: module.ChatInteractionOverlay,
  })),
)

export function HitlAttentionBody({
  item,
  session,
  sessionTitle,
  openChat,
  settle,
  keyboardActive = true,
  embedded = false,
}: AttentionBodyProps & { keyboardActive?: boolean; embedded?: boolean }) {
  // The item carries the whole `hitl.requested` payload; the request is its `request` field.
  const interaction = useMemo(
    () => fromHitlRequest((item.interaction as { request?: unknown } | undefined)?.request),
    [item.interaction],
  )
  const [submittingId, setSubmittingId] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const inFlight = useRef(false)

  // The request belongs to a chat that is by construction NOT the one on screen, so the row
  // names that chat; without it the Event Center would link to whichever chat is open.
  const origin = {
    kind: 'session' as const,
    sessionId: item.sessionId,
    projectId: session?.projectId ?? null,
  }
  const onError = (err: unknown) => {
    const code = err instanceof ApiError ? err.code : null
    if (code === 'hitl_request_not_active' || code === 'secret_request_not_active') {
      settle()
      toast.info('The request is no longer active', { origin })
    } else {
      setFailure(errorMessage(err, '') || 'Could not send your answer')
      toast.error('Could not send your answer', {
        description: errorMessage(err, '') || undefined,
        origin,
      })
    }
  }

  // Every answer goes through the same calls the in-chat overlay uses. On success the item is
  // settled here at once; the server's next roster no longer lists it and reveals the next one.
  const submit = (requestId: string, call: () => Promise<unknown>) => {
    if (inFlight.current) return
    inFlight.current = true
    setFailure(null)
    setSubmittingId(requestId)
    void Promise.resolve()
      .then(call)
      .then(settle)
      .catch(onError)
      .finally(() => {
        inFlight.current = false
        setSubmittingId(null)
      })
  }

  const content = (
    <>
      {failure && (
        <p role="alert" className="px-4 py-2 text-xs text-status-error">
          {failure}
        </p>
      )}
      {interaction ? (
        <Suspense
          fallback={<LoadingHint className="min-h-28 text-xs">Loading request…</LoadingHint>}
        >
          <ChatInteractionOverlay
            interaction={interaction}
            submittingRequestId={submittingId}
            keyboardActive={keyboardActive}
            // In a dialog the frame is its BODY and adopts the modal measure and seam; the island
            // has no dialog and keeps the compact padding.
            chrome={embedded ? 'compact' : 'dialog'}
            onAnswer={(requestId, answers) =>
              submit(requestId, () => backendClient.interact(requestId, 'respond', { answers }))
            }
            // request_secret values ride their own submit-secret channel (straight to the
            // encrypted vault) — never the interact() respond path.
            onSubmitSecret={(requestId, value) =>
              submit(requestId, () => backendClient.submitSecret(requestId, value))
            }
            onDismiss={(requestId) =>
              submit(requestId, () => backendClient.interact(requestId, 'dismiss'))
            }
          />
        </Suspense>
      ) : (
        // An edge-to-edge dialog owns no `DialogBody` (one scroll owner — the interaction frame
        // in the branch above); the unreadable-payload fallback is a plain padded line.
        <p className="px-4 py-3 text-xs text-text-soft">{item.title}</p>
      )}
    </>
  )
  // The agent island has no dialog around it: the same body under a plain header.
  if (embedded)
    return (
      <section aria-label={sessionTitle}>
        <header className="flex items-center justify-between gap-2 border-b border-border-soft px-3 py-2">
          <h2 className="truncate text-2xs font-medium text-text-soft">{sessionTitle}</h2>
          <Button variant="ghost" size="xs" onClick={openChat}>
            Open chat
            <ArrowUpRight />
          </Button>
        </header>
        {content}
      </section>
    )
  return (
    <DialogContent
      size="md"
      layout="edge-to-edge"
      showCloseButton={false}
      aria-describedby={undefined}
    >
      <DialogHeader
        className="items-center gap-2 border-b border-border-soft px-4 py-2"
        actionsLabel="Background request actions"
        actions={
          <Button variant="ghost" size="xs" onClick={openChat} className="text-text-faint">
            Open chat
            <ArrowUpRight className="size-3" />
          </Button>
        }
      >
        <DialogTitle className="flex min-w-0 items-center gap-1.5 text-2xs font-medium">
          <span className="truncate text-text-soft">{sessionTitle}</span>
          <span className="shrink-0 font-normal text-text-faint">needs your input</span>
        </DialogTitle>
      </DialogHeader>
      {content}
    </DialogContent>
  )
}
