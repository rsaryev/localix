/**
 * A saved request's tab — the request/response workbench, built from Localix primitives:
 *
 *   ┌ url bar: method · url · Save · Send ──────────────────────────────┐
 *   ├ request pane: Params · Body · Auth · Headers · Settings ──────────┤
 *   ├ draggable horizontal divider ─────────────────────────────────────┤
 *   │ response: Body · Headers · Timeline · status · time · size         │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * Request is always above response: both keep the full available width, so long URLs, header
 * values, and JSON are not squeezed into a narrow internal column. This file is the layout shell;
 * the response surface lives in `ui/ResponsePane.tsx`.
 *
 * It EDITS the url, method, headers, query, path parameters, body and auth. No autosave — the agent
 * may re-send the same session request mid-turn, and autosaving a half-typed url would make it
 * briefly the real one. But SEND COMMITS: pressing Send with a dirty draft saves it first and then
 * sends, because Send IS the "this is the request I mean" decision — without that, a freshly
 * minted request could never send at all (its stored url is blank until the first save).
 *
 * Auth has a separate route from the replace-all request edit: masked values mean “keep the stored
 * reference”, while a newly typed literal is moved into the vault before session JSON is written.
 * The browser never receives the resolved credential value.
 *
 * Response history is the server's (last N sends, agent's included) — a dropdown flips back
 * through them without adding a second permanent toolbar to the compact response header.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CornerDownRight, Save, Send, Square } from 'lucide-react'
import { ApiProblem, useApiProblem } from './problems'
import { Chip } from '@localixai/kit/chip'
import { WorkbenchSash } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { Input } from '@localixai/kit/input'
import { Select } from '@localixai/kit/select'
import { TabBar } from '@localixai/kit/tabs'
import { Switch } from '@localixai/kit/switch'
import { WorkbenchToolbar } from '@localixai/kit/workbench-toolbar'
import { useWorkItemVisible } from '@localixai/plugin-sdk/ui/visibility'
import { usePaneResize } from '@localixai/kit/pane-resize'
import { cn, FIELD_SURFACE } from '@localixai/plugin-sdk/ui/classes'
import type {
  EnvVariable,
  HistoryEntryInfo,
  HistorySource,
  RequestInfo,
  ResolvedPreview,
  SendResponse,
} from '../backend/contracts'
import { methodTone } from './model/presentation'
import { RestApiError, restApi } from './restApi'
import { useRequest } from './model/useRequest'
import { useRequestEdit } from './model/useRequestEdit'
import { useEnvironments } from './model/useEnvironments'
import { PairEditor } from './ui/PairEditor'
import { ParamsEditor } from './ui/ParamsEditor'
import { BodyEditor } from './ui/BodyEditor'
import { AuthEditor } from './ui/AuthEditor'
import { FormRow } from './ui/FormRow'
import { ResponsePane } from './ui/ResponsePane'
import { queryDraftFromUrl, urlWithQuery } from './model/querySync'
import { syncPathParameters } from './model/pathSync'
import { subscribeApiWorkspaceCommands } from './model/collectionEvents'
import { acknowledgeInline, type PublishMessageContext } from '@localixai/plugin-sdk/ui'
import { buildRequestMessageContext } from './model/requestMessageContext'
import {
  FORM_URLENCODED,
  MULTIPART_FORM,
  HTTP_METHODS,
  methodAllowsBody,
  type HttpMethod,
} from '../backend/request-spec'

/** Static map — a template-built `text-status-…` class would never reach the Tailwind build. */
const TONE_TEXT: Record<string, string> = {
  success: 'text-status-success',
  warning: 'text-status-warning',
  error: 'text-status-error',
  info: 'text-status-info',
}

export function RequestTab({
  sessionId,
  name,
  publishMessageContext,
}: {
  /** The chat whose project holds this request — the tab's own session, never the active one. */
  sessionId: string
  name: string
  publishMessageContext?: PublishMessageContext
}) {
  const workItemVisible = useWorkItemVisible()
  const { request, resolved, loading, error, reload } = useRequest(sessionId, name)
  // The active environment's variables feed the body editor's `{{variable}}` autocomplete.
  const { active } = useEnvironments(sessionId)
  // The response being READ: the latest send, or a history entry the dropdown picked.
  const [response, setResponse] = useState<SendResponse | null>(null)
  const [history, setHistory] = useState<HistoryEntryInfo[]>([])
  const [historyId, setHistoryId] = useState<number | null>(null)
  const [responseSource, setResponseSource] = useState<HistorySource | null>(null)
  const [sending, setSending] = useState(false)
  const [agentSending, setAgentSending] = useState(false)
  const [sendError, setSendError] = useState<{ message: string; detail?: string } | null>(null)
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

  // Owned above the returns: the branch that draws it disappears the moment the request loads,
  // and an owner that disappears never settles the row it published.
  const loadProblem = useApiProblem({ subject: name, message: error, centered: true })

  // Only the FIRST load blanks the tab. A reload (after save/rename/auth) keeps the request on
  // screen so `Loaded` never unmounts — otherwise its tab state (which pane is open) resets and
  // saving auth would bounce you back to Params.
  if (loading && !request) return <LoadingHint className="p-4">Loading “{name}”…</LoadingHint>
  // A request that could not be READ and a request that does not exist are different situations:
  // the first is a failure with a record behind it, the second is an ordinary empty tab.
  if (error) return loadProblem
  if (!request) return <EmptyHint className="p-4">No saved request named “{name}”.</EmptyHint>

  return (
    <Loaded
      key={request.name}
      sessionId={sessionId}
      request={request}
      resolved={resolved}
      response={response}
      responseSource={responseSource}
      history={history}
      historyId={historyId}
      onPickHistory={(id) => {
        const entry = history.find((e) => e.id === id)
        if (!entry) return
        setHistoryId(id)
        setResponse(entry.response)
        setResponseSource(entry.source)
        setSendError(null)
      }}
      variables={active?.variables ?? []}
      sending={sending}
      agentSending={agentSending}
      sendError={sendError}
      onSend={send}
      onCancelSend={cancelSend}
      onClearHistory={clearHistory}
      // Fire-and-forget refresh; a promise handed to a callback prop is a floating rejection.
      onSaved={() => void reload()}
    />
  )
}

/**
 * What a templated url actually resolves to, under the environment that is active right now.
 * The url bar shows the TEMPLATE (that is what is saved and portable); a person about to press
 * Send needs the destination too. The gap between the two IS environments, so both are shown.
 */
function ResolvedLine({ resolved }: { resolved: ResolvedPreview }) {
  if (resolved.missing.length > 0) {
    return (
      <div className="flex items-center gap-2 border-b border-border-soft px-3 py-1.5 text-2xs">
        <AlertTriangle className="size-3.5 shrink-0 text-status-warning" />
        <span className="min-w-0 flex-1">
          {resolved.environment
            ? `“${resolved.environment}” does not define `
            : 'No environment is active, so nothing defines '}
          {resolved.missing.map((m) => `{{${m}}}`).join(', ')} — this request will not send.
        </span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 border-b border-border-soft px-3 py-1.5">
      <CornerDownRight className="size-3.5 shrink-0 text-text-faint" />
      <span
        className="min-w-0 flex-1 truncate font-mono text-2xs text-text-faint"
        title={resolved.url}
      >
        {resolved.url}
      </span>
      {resolved.environment && (
        <Chip tone="neutral" className="shrink-0">
          {resolved.environment}
        </Chip>
      )}
    </div>
  )
}

type RequestTabId = 'params' | 'body' | 'auth' | 'headers' | 'settings'

/** Body mime choices, reduced to what our spec model carries. */
const BODY_TYPES = [
  { value: '', label: 'No body' },
  { value: 'application/json', label: 'JSON' },
  { value: 'text/plain', label: 'Plain text' },
  { value: 'application/xml', label: 'XML' },
  { value: FORM_URLENCODED, label: 'Form URL-encoded' },
  { value: MULTIPART_FORM, label: 'Multipart form-data' },
] as const

function Loaded({
  sessionId,
  request,
  resolved,
  response,
  responseSource,
  history,
  historyId,
  onPickHistory,
  onClearHistory,
  variables,
  sending,
  agentSending,
  sendError,
  onSend,
  onCancelSend,
  onSaved,
}: {
  sessionId: string
  request: RequestInfo
  resolved?: ResolvedPreview
  response: SendResponse | null
  responseSource: HistorySource | null
  history: HistoryEntryInfo[]
  historyId: number | null
  onPickHistory: (id: number) => void
  onClearHistory: () => void
  variables: ReadonlyArray<EnvVariable>
  sending: boolean
  agentSending: boolean
  sendError: { message: string; detail?: string } | null
  onSend: () => void
  onCancelSend: () => void
  onSaved: () => void
}) {
  const requestBusy = sending || agentSending
  const saved = useCallback(() => onSaved(), [onSaved])
  const {
    draft,
    dirty,
    saving,
    error: saveError,
    patch,
    setPairs,
    save,
  } = useRequestEdit(sessionId, request, saved)
  const [reqTab, setReqTab] = useState<RequestTabId>('params')
  // Request is always above response. That is the stable reading order of this workbench: compose
  // against the full width, send, then inspect a full-width response without squeezing headers or
  // long JSON into a narrow right column. The horizontal sash keeps the allocation user-owned.
  const panes = useRef<HTMLDivElement>(null)
  const split = usePaneResize({
    axis: 'y',
    initial: 360,
    min: 200,
    max: 900,
    // New key deliberately drops widths/heights saved by the retired switchable layout.
    storageKey: 'rest-api.request-pane.height.v2',
    containerRef: panes,
    // `Loaded` mounts before `useRequestEdit` has produced its draft, so the panes ref is null on
    // the hook's first effect. Re-measure when the conditional workbench actually enters the DOM.
    measureKey: draft != null,
    // Keep enough response visible for its toolbar and several code lines.
    reserve: 240,
  })

  if (!draft) return null
  const { auth } = request.spec

  // Send commits: a dirty draft is saved first, and the send only fires if the server took it
  // (a refusal — bad url, taken name — is already on screen as the save error).
  const sendNow = () => {
    if (requestBusy || saving) return
    if (!dirty) {
      onSend()
      return
    }
    void save().then((ok) => {
      if (ok) onSend()
    })
  }

  const activeCount = (pairs?: { disabled?: boolean }[]) =>
    (pairs ?? []).filter((p) => !p.disabled).length
  const paramsCount = activeCount(draft.query) + activeCount(draft.pathParameters)
  const headersCount = activeCount(draft.headers)
  const hasBody = Boolean(draft.body?.text?.trim() || draft.body?.form?.length)
  // The whole `followRedirects` fallback is `true` — the plugin default when the request sets none.
  const followRedirects = draft.followRedirects ?? true
  const hasSettings =
    draft.followRedirects === false || draft.timeoutMs != null || draft.maxRedirects != null

  const setBodyType = (mimeType: string) => {
    if (mimeType === '') {
      patch({ body: undefined })
    } else if (mimeType === FORM_URLENCODED || mimeType === MULTIPART_FORM) {
      // Both encodings carry `form[]`; the mime is what decides the wire bytes. Preserve the draft
      // rows so switching urlencoded ↔ multipart never drops the fields already entered.
      patch({ body: { mimeType, form: draft.body?.form ?? [] } })
    } else {
      patch({ body: { mimeType, text: draft.body?.text ?? '' } })
    }
  }
  const displayUrl = urlWithQuery(draft.url, draft.query)
  const canSendBody = methodAllowsBody(draft.method as HttpMethod)

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
      // Cmd/Ctrl+S saves; Cmd/Ctrl+Enter sends from anywhere in the request. Plain Enter stays the
      // URL field's own (see its handler); in a textarea it is a newline.
      onKeyDown={(e) => {
        if (e.key.toLowerCase() === 's' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          if (dirty && !saving && !requestBusy) void save()
          return
        }
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          sendNow()
        }
      }}
    >
      {/* One request command bar. The actions stay mounted so dirty
          state never makes the URL field jump sideways. */}
      <WorkbenchToolbar aria-label="Request controls" className="gap-1.5 px-2">
        <div
          className={cn(
            FIELD_SURFACE,
            'flex min-w-0 flex-1 items-center overflow-hidden transition-colors duration-(--dur-fast) focus-within:border-control-border-hover',
          )}
        >
          <Select
            aria-label="Method"
            size="lg"
            className={cn(
              'w-20 shrink-0 rounded-none border-0 border-r border-border-soft bg-transparent font-mono font-semibold shadow-none focus-ring',
              TONE_TEXT[methodTone(draft.method as HttpMethod)],
            )}
            value={draft.method}
            options={HTTP_METHODS.map((m) => ({ value: m, label: m }))}
            onValueChange={(method) => patch({ method })}
          />
          <Input
            size="lg"
            className="min-w-0 flex-1 rounded-none border-0 bg-transparent font-mono text-xs shadow-none focus-ring"
            value={displayUrl}
            placeholder="https://api.example.dev/things or {{base_url}}/things"
            onChange={(e) => {
              const next = queryDraftFromUrl(e.target.value, draft.query)
              patch({
                ...next,
                pathParameters: syncPathParameters(next.url, draft.pathParameters),
              })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                sendNow()
              }
            }}
            aria-label="URL"
            spellCheck={false}
          />
          <IconButton
            size="lg"
            className={cn(
              'shrink-0 rounded-none border-l border-border-soft',
              dirty && 'text-status-warning',
            )}
            aria-label={saving ? 'Saving request' : 'Save request'}
            tooltip={dirty ? 'Save request (Ctrl/Cmd+S)' : 'Request is saved'}
            onClick={() => void save()}
            disabled={!dirty || saving || requestBusy}
          >
            <Save className={cn('size-3.5', saving && 'animate-pulse')} />
          </IconButton>
          <IconButton
            size="lg"
            className={cn(
              'shrink-0 rounded-none border-l border-border-soft',
              !requestBusy && 'text-status-info',
            )}
            aria-label={
              sending ? 'Cancel request' : agentSending ? 'Agent is sending request' : 'Send'
            }
            tooltip={
              sending
                ? 'Cancel request'
                : agentSending
                  ? 'Agent is sending this request'
                  : 'Send (⌘↵)'
            }
            onClick={sending ? onCancelSend : sendNow}
            disabled={saving || agentSending}
          >
            {sending ? (
              <Square className="size-3.5 fill-current" />
            ) : (
              <Send className={cn('size-3.5', agentSending && 'animate-pulse')} />
            )}
          </IconButton>
        </div>
      </WorkbenchToolbar>

      <ApiProblem subject={request.name} message={saveError} />
      {resolved && !dirty && <ResolvedLine resolved={resolved} />}

      {/* One stable vertical reading order: request, horizontal sash, response. */}
      <div ref={panes} className="flex min-h-0 flex-1 flex-col">
        <div
          className="flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden"
          style={{ height: split.size }}
        >
          {/* The body-type picker rides in TabBar's `trailing` slot, so the tab row and
              the control share ONE row and ONE seam — the strip no longer has to
              suppress its underline for a wrapper to redraw it. */}
          <TabBar<RequestTabId>
            aria-label="Request configuration"
            className="px-1"
            items={[
              { id: 'params', label: 'Params', badge: paramsCount > 0 ? paramsCount : undefined },
              { id: 'body', label: 'Body', badge: hasBody ? '•' : undefined },
              {
                id: 'headers',
                label: 'Headers',
                badge: headersCount > 0 ? headersCount : undefined,
              },
              { id: 'auth', label: 'Auth', badge: auth.type !== 'none' ? '•' : undefined },
              { id: 'settings', label: 'Settings', badge: hasSettings ? '•' : undefined },
            ]}
            active={reqTab}
            onChange={setReqTab}
            trailing={
              reqTab === 'body' ? (
                // `self-stretch` keeps the divider running the full row height, as it
                // did when this box was a sibling of the strip.
                <div className="flex shrink-0 self-stretch items-center border-l border-border-soft px-2">
                  <Select
                    aria-label="Body type"
                    size="md"
                    align="end"
                    className="w-32 border-0 bg-transparent shadow-none"
                    value={draft.body?.mimeType ?? (draft.body?.form ? FORM_URLENCODED : '')}
                    options={[...BODY_TYPES]}
                    onValueChange={setBodyType}
                    disabled={!canSendBody}
                  />
                </div>
              ) : undefined
            }
          />
          <div
            className={cn(
              'min-h-0 flex-1',
              reqTab === 'body' ? 'overflow-hidden' : 'scrollbar-thin overflow-y-auto',
            )}
          >
            {reqTab === 'params' && (
              <ParamsEditor
                query={draft.query}
                path={syncPathParameters(draft.url, draft.pathParameters)}
                variables={variables}
                onQueryChange={(next) => setPairs('query', next)}
                onPathChange={(next) => setPairs('pathParameters', next)}
              />
            )}
            {reqTab === 'body' && (
              <div
                className={cn(
                  'flex h-full min-h-0 flex-col',
                  draft.body?.form ? 'scrollbar-thin overflow-auto' : 'overflow-hidden',
                )}
              >
                {!canSendBody ? (
                  <div className="px-3 py-2 text-2xs text-text-faint">
                    {draft.method} does not send a body.
                    {draft.body ? ' The configured body is preserved for another method.' : ''}
                  </div>
                ) : draft.body ? (
                  draft.body.form ? (
                    <PairEditor
                      label="Form fields"
                      pairs={draft.body.form}
                      onChange={(form) => patch({ body: { ...draft.body, form } })}
                      variables={variables}
                    />
                  ) : (
                    <BodyEditor
                      value={draft.body.text ?? ''}
                      mimeType={draft.body.mimeType}
                      variables={variables}
                      onChange={(text) => patch({ body: { ...draft.body, text } })}
                      onSave={() => void save()}
                      onSubmit={sendNow}
                    />
                  )
                ) : (
                  <EmptyHint className="flex-1">
                    This request sends no body. Pick a type above to add one.
                  </EmptyHint>
                )}
              </div>
            )}
            {reqTab === 'auth' && (
              <AuthEditor sessionId={sessionId} name={request.name} auth={auth} onSaved={onSaved} />
            )}
            {reqTab === 'headers' && (
              <PairEditor
                label="Headers"
                pairs={draft.headers}
                onChange={(next) => setPairs('headers', next)}
                namePlaceholder="Accept"
                valuePlaceholder="application/json"
                variables={variables}
              />
            )}
            {reqTab === 'settings' && (
              <div>
                <div className="border-b border-border-soft">
                  <FormRow label="Follow redirects" hint="Follow 3xx responses to their target.">
                    <Switch
                      aria-label="Follow redirects"
                      checked={followRedirects}
                      onChange={() => patch({ followRedirects: !followRedirects })}
                    />
                  </FormRow>
                  <FormRow label="Timeout">
                    <span className="flex items-center gap-2">
                      <Input
                        type="number"
                        min={1}
                        size="md"
                        className="w-40 font-mono text-xs"
                        value={draft.timeoutMs ?? ''}
                        placeholder="Default"
                        onChange={(e) =>
                          patch({
                            timeoutMs: e.target.value === '' ? undefined : Number(e.target.value),
                          })
                        }
                      />
                      <span className="shrink-0 text-2xs text-text-faint">ms</span>
                    </span>
                  </FormRow>
                  <FormRow label="Max redirects">
                    <Input
                      type="number"
                      min={1}
                      size="md"
                      className="w-40 font-mono text-xs"
                      value={draft.maxRedirects ?? ''}
                      placeholder="Default"
                      onChange={(e) =>
                        patch({
                          maxRedirects: e.target.value === '' ? undefined : Number(e.target.value),
                        })
                      }
                    />
                  </FormRow>
                </div>
                <p className="px-3 py-2 text-2xs text-text-faint">
                  Leave a field blank to use the plugin default. Saved with the request.
                </p>
              </div>
            )}
          </div>
        </div>

        <WorkbenchSash
          label="Resize the request pane"
          orientation="horizontal"
          className="relative z-(--z-controls) -my-[calc(var(--sash-hit-area)/2)]"
          valueNow={split.size}
          valueMin={split.min}
          valueMax={split.limit}
          resetLabel="reset the request pane size"
          active={split.resizing}
          onPointerDown={split.onResizeStart}
          onKeyDown={split.onResizeKeyDown}
          onDoubleClick={split.reset}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ResponsePane
            name={request.name}
            response={response}
            responseSource={responseSource}
            history={history}
            historyId={historyId}
            onPickHistory={onPickHistory}
            onClearHistory={onClearHistory}
            sending={requestBusy}
            sendingLabel={agentSending ? 'Agent is calling…' : 'Sending…'}
            sendError={sendError}
          />
        </div>
      </div>
    </div>
  )
}
