/**
 * The send/response state of one saved request's tab: the response being read (latest send or a
 * picked history entry), the server's history ring, the user's own send with cancel, and the
 * agent's sends of the same request in the same chat.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { acknowledgeInline, type PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import { useWorkItemVisible } from '@localixai/mini-app-sdk/ui/visibility'
import type { HistoryEntryInfo, HistorySource, SendResponse } from '../../backend/contracts'
import { RestApiError, restApi } from '../restApi'
import { subscribeApiWorkspaceCommands } from './collectionEvents'
import { buildRequestMessageContext } from './requestMessageContext'

export type SendError = { message: string; detail?: string }

export function useRequestSend(
  sessionId: string,
  name: string,
  publishMessageContext?: PublishMessageContext,
) {
  const workItemVisible = useWorkItemVisible()
  // The response being READ: the latest send, or a history entry the dropdown picked.
  const [response, setResponse] = useState<SendResponse | null>(null)
  const [history, setHistory] = useState<HistoryEntryInfo[]>([])
  const [historyId, setHistoryId] = useState<number | null>(null)
  const [responseSource, setResponseSource] = useState<HistorySource | null>(null)
  const [sending, setSending] = useState(false)
  const [agentSending, setAgentSending] = useState(false)
  const [sendError, setSendError] = useState<SendError | null>(null)
  const sendController = useRef<AbortController | null>(null)

  useEffect(() => {
    if (!publishMessageContext) return
    // The active request is useful context BEFORE the first send. The inspected response becomes
    // a second facet. Both are native bindings captured with this work item's session scope.
    publishMessageContext(buildRequestMessageContext(name, response))
  }, [name, publishMessageContext, response])

  const loadHistory = useCallback(
    (isCurrent: () => boolean = () => true, selectLatest = false) => {
      void restApi
        .history(sessionId, name)
        .then((entries) => {
          if (!isCurrent()) return
          setHistory(entries)
          // First open of a tab with past sends: show the most recent one instead of an empty
          // pane — the request was used, and what it last returned is the context you came for.
          setResponse((current) =>
            selectLatest
              ? (entries[0]?.response ?? current)
              : (current ?? entries[0]?.response ?? null),
          )
          setResponseSource((current) =>
            selectLatest
              ? (entries[0]?.source ?? current)
              : (current ?? entries[0]?.source ?? null),
          )
          if (selectLatest && entries.length > 0) setHistoryId(null)
        })
        .catch(() => {
          // History is a convenience; a failed fetch leaves the pane usable.
        })
    },
    [sessionId, name],
  )
  useEffect(() => {
    if (!workItemVisible) return
    let cancelled = false
    loadHistory(() => !cancelled)
    return () => {
      cancelled = true
    }
  }, [loadHistory, workItemVisible])

  useEffect(
    () =>
      subscribeApiWorkspaceCommands((command, commandSession) => {
        // Another chat's agent sending a request of the same name is not this tab's send.
        if (command.type !== 'request_send' || command.name !== name) return
        if (commandSession !== sessionId) return
        if (command.phase === 'started') {
          setAgentSending(true)
          setSendError(null)
          return
        }
        setAgentSending(false)
        if (command.phase === 'failed') {
          setSendError({
            message:
              'The agent request did not complete. Its tool result in the conversation has the details.',
          })
          return
        }
        // `completed` is emitted only after the redacted response entered the shared history ring.
        loadHistory(() => true, true)
      }),
    [loadHistory, name, sessionId],
  )

  // `void`-returning: click callbacks — a promise handed to one is a floating rejection nobody
  // awaits. The state updates ARE the result.
  const send = () => {
    if (sendController.current) return
    const controller = new AbortController()
    sendController.current = controller
    setSending(true)
    setSendError(null)
    void restApi
      .send(sessionId, name, controller.signal)
      .then((res) => {
        setResponse(res)
        setResponseSource('user')
        setHistoryId(null)
        loadHistory()
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return
        acknowledgeInline(err)
        // Keep the last good response on screen — a failure is read AGAINST what last worked, so
        // blanking the pane throws away the context. The error rides above it as a strip.
        // `message` is the classified sentence the route sent; `detail` is what the upstream (or
        // the socket) actually said, which can be a whole response body.
        setSendError({
          message: err instanceof Error ? err.message : 'The request could not be sent.',
          ...(err instanceof RestApiError && err.detail ? { detail: err.detail } : {}),
        })
      })
      .finally(() => {
        if (sendController.current === controller) {
          sendController.current = null
          setSending(false)
        }
      })
  }

  const cancelSend = () => sendController.current?.abort()

  useEffect(
    () => () => {
      sendController.current?.abort()
      sendController.current = null
    },
    [name],
  )

  // Drop this request's response log. The currently-shown response stays put — you cleared the
  // history, not the view you are reading.
  const clearHistory = () => {
    void restApi
      .clearHistory(sessionId, name)
      .then(() => {
        setHistory([])
        setHistoryId(null)
      })
      .catch(() => {
        // A failed clear leaves the log as it was — nothing to recover.
      })
  }

  const pickHistory = (id: number) => {
    const entry = history.find((e) => e.id === id)
    if (!entry) return
    setHistoryId(id)
    setResponse(entry.response)
    setResponseSource(entry.source)
    setSendError(null)
  }

  return {
    response,
    responseSource,
    history,
    historyId,
    sending,
    agentSending,
    sendError,
    send,
    cancelSend,
    clearHistory,
    pickHistory,
  }
}

export type RequestSendState = ReturnType<typeof useRequestSend>
