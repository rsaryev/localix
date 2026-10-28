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

import { useCallback, useRef, useState } from 'react'
import { ApiProblem, useApiProblem } from './problems'
import { WorkbenchSash } from '@localixai/kit/button'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { Select } from '@localixai/kit/select'
import { TabBar } from '@localixai/kit/tabs'
import { WorkbenchToolbar } from '@localixai/kit/workbench-toolbar'
import { usePaneResize } from '@localixai/kit/pane-resize'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import type { PublishMessageContext } from '@localixai/mini-app-sdk/ui'
import type { EnvVariable, RequestInfo, ResolvedPreview } from '../backend/contracts'
import { useRequest } from './model/useRequest'
import { useRequestEdit } from './model/useRequestEdit'
import { useEnvironments } from './model/useEnvironments'
import { useRequestSend, type RequestSendState } from './model/useRequestSend'
import { PairEditor } from './ui/PairEditor'
import { ParamsEditor } from './ui/ParamsEditor'
import { AuthEditor } from './ui/AuthEditor'
import { ResponsePane } from './ui/ResponsePane'
import { ResolvedLine } from './ui/ResolvedLine'
import { RequestUrlBar } from './ui/RequestUrlBar'
import { RequestBodyPane } from './ui/RequestBodyPane'
import { RequestSettings } from './ui/RequestSettings'
import { syncPathParameters } from './model/pathSync'
import {
  FORM_URLENCODED,
  MULTIPART_FORM,
  methodAllowsBody,
  type HttpMethod,
} from '../backend/request-spec'

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
  const { request, resolved, loading, error, reload } = useRequest(sessionId, name)
  // The active environment's variables feed the body editor's `{{variable}}` autocomplete.
  const { active } = useEnvironments(sessionId)
  const send = useRequestSend(sessionId, name, publishMessageContext)

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
      variables={active?.variables ?? []}
      send={send}
      // Fire-and-forget refresh; a promise handed to a callback prop is a floating rejection.
      onSaved={() => void reload()}
    />
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
  variables,
  send,
  onSaved,
}: {
  sessionId: string
  request: RequestInfo
  resolved?: ResolvedPreview
  variables: ReadonlyArray<EnvVariable>
  send: RequestSendState
  onSaved: () => void
}) {
  const { response, responseSource, history, historyId, sending, agentSending, sendError } = send
  const onSend = send.send
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
  const canSendBody = methodAllowsBody(draft.method as HttpMethod)

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
      // No semantics of its own: it only catches the shortcuts bubbling up from its controls.
      role="presentation"
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
        <RequestUrlBar
          draft={draft}
          patch={patch}
          dirty={dirty}
          saving={saving}
          sending={sending}
          agentSending={agentSending}
          onSave={() => void save()}
          onSend={sendNow}
          onCancelSend={send.cancelSend}
        />
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
              <RequestBodyPane
                draft={draft}
                canSendBody={canSendBody}
                variables={variables}
                patch={patch}
                onSave={() => void save()}
                onSubmit={sendNow}
              />
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
            {reqTab === 'settings' && <RequestSettings draft={draft} patch={patch} />}
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
            onPickHistory={send.pickHistory}
            onClearHistory={send.clearHistory}
            sending={requestBusy}
            sendingLabel={agentSending ? 'Agent is calling…' : 'Sending…'}
            sendError={sendError}
          />
        </div>
      </div>
    </div>
  )
}
