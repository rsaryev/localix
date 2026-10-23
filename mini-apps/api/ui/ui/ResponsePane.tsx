/**
 * The response side of a request tab — a compact response workbench.
 *
 *   ┌ Response · Headers · Timeline ─ status · time · size · ⋯ ────────┐
 *   │ <syntax-aware body, headers table, cookies, or redirect timeline> │
 *   └────────────────────────────────────────────────────────────────────┘
 *
 * Extracted from `RequestTab` so the tab is just the layout shell and this owns everything about
 * reading a response. The error model lives HERE too: a failed send does NOT blank the pane — the
 * last good response stays on screen and the failure shows as a thin strip above it, because the
 * question a send failure raises ("what changed since it last worked?") needs the last response to
 * answer. A genuinely empty pane (never sent) is the only centered EmptyHint.
 *
 * Every view is the REDACTED wire view — a literal secret never reaches this component. The body,
 * headers, cookies and hop urls are all masked upstream (see contracts.ts), so copy and download
 * are safe by construction. Agent context is published by the mounted request tab, not a button.
 */

import { useMemo, useState } from 'react'
import { AlertTriangle, Check, Copy, Download, MoreHorizontal, Trash2 } from 'lucide-react'
import { ApiProblem } from '../problems'
import { Chip } from '@localixai/kit/chip'
import { Button } from '@localixai/kit/button'
import { CodeEditor } from '@localixai/kit/code-editor'
import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { IconButton } from '@localixai/kit/icon-button'
import { Spinner } from '@localixai/kit/spinner'
import { TabBar } from '@localixai/kit/tabs'
import { WorkbenchToolbar } from '@localixai/kit/workbench-toolbar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { useCopied } from '@localixai/mini-app-sdk/ui/interactions'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import type {
  HistoryEntryInfo,
  HistorySource,
  RedirectHop,
  SendResponse,
} from '../../backend/contracts'
import { formatBytes, formatMs, statusTone } from '../model/presentation'
import { editorLanguage, formatJsonBody } from '../model/bodyEditor'

const timeOf = (at: number) => new Date(at).toLocaleTimeString(undefined, { hour12: false })

/** The download extension for a body's editor grammar — the same mapping the editor uses. */
const EXTENSION: Record<string, string> = {
  json: 'json',
  html: 'html',
  xml: 'xml',
  text: 'txt',
}

type ResponseTabId = 'body' | 'headers' | 'cookies' | 'timeline'

const STATUS_TEXT = {
  success: 'text-status-success',
  warning: 'text-status-warning',
  error: 'text-status-error',
  info: 'text-status-info',
  neutral: 'text-text-soft',
  accent: 'text-accent-foreground',
} as const

/** A ghost text-button that copies `text` and flips to a check for a beat. */
function CopyTextButton({ text, label }: { text: string; label: string }) {
  const { copied, copy } = useCopied()
  return (
    <Button size="sm" variant="ghost" onClick={() => void copy(text)} title={label}>
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? 'Copied' : label}
    </Button>
  )
}

/**
 * The name/value table shared by Headers and Cookies — they are the same shape, so they are the
 * same control (a plain key/value grid). Name cells are `<th scope="row">`
 * so a screen reader announces each value against its header.
 */
function KvTable({ rows, copyAllLabel }: { rows: Array<[string, string]>; copyAllLabel: string }) {
  const allText = rows.map(([n, v]) => `${n}: ${v}`).join('\n')
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <WorkbenchToolbar density="slim" aria-label="Response table actions" className="justify-end">
        <CopyTextButton text={allText} label={copyAllLabel} />
      </WorkbenchToolbar>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[36rem] table-fixed border-collapse text-left font-mono text-xs">
          <colgroup>
            <col className="w-[32%]" />
            <col />
          </colgroup>
          {/* The shared occluder hides rows scrolling under the header without a second ground. */}
          <thead className="lx-occluder sticky top-0 z-[1] text-2xs font-medium text-text-faint">
            <tr className="h-7 border-b border-border-soft">
              <th className="px-3 font-medium">Name</th>
              <th className="border-l border-border-soft px-3 font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([name, value], index) => (
              <tr
                key={`${name}:${index}`}
                className="border-b border-border-faint align-top odd:bg-foreground/[0.025] hover:bg-surface-hover/45"
              >
                <th scope="row" className="px-3 py-1.5 text-left font-normal text-text-soft">
                  <span className="break-words">{name}</span>
                </th>
                <td className="border-l border-border-soft px-3 py-1.5 text-foreground">
                  <span className="whitespace-pre-wrap break-words">{value}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** The redirect chain as `301 → 302 → 200`, then one line per hop with its url and timing. */
function Timeline({ hops }: { hops: RedirectHop[] }) {
  return (
    <div className="space-y-3">
      <div className="font-mono text-xs text-text-soft">
        {hops.map((h) => h.status).join(' → ')}
      </div>
      <ol className="space-y-1">
        {hops.map((h) => (
          <li
            key={`${h.status}:${h.elapsedMs}:${h.url}`}
            className="flex items-center gap-2 text-2xs"
          >
            <Chip tone={statusTone(h.status)} className="shrink-0 font-mono">
              {h.status}
            </Chip>
            <span className="w-16 shrink-0 text-text-faint">{formatMs(h.elapsedMs)}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-text-faint" title={h.url}>
              {h.url}
            </span>
          </li>
        ))}
      </ol>
    </div>
  )
}

/** A single syntax-aware response body without a second inspection surface competing below it. */
function BodySection({
  response,
  language,
  shown,
}: {
  response: SendResponse
  language: string
  shown: string
}) {
  if (response.body === '') return <EmptyHint>No body.</EmptyHint>

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <CodeEditor
        value={shown}
        language={language}
        readOnly
        stickyScrollEnabled={false}
        scrollbarMarkersEnabled={false}
        bracketColorizationEnabled
        ariaLabel="Response body"
        // No ground coat: the editor fills the response pane, which already inherits the host
        // pane's ground — and under the macOS glass theme that token carries alpha, so a second
        // pane-sized coat compounds into an opaque slab.
        className="min-h-0 flex-1 border-0"
      />
    </div>
  )
}

export function ResponsePane({
  name,
  response,
  responseSource,
  history,
  historyId,
  onPickHistory,
  onClearHistory,
  sending,
  sendingLabel = 'Sending…',
  sendError,
}: {
  /** The saved request this response came from — the handle the agent hand-off links to. */
  name: string
  /** The response being READ, or null when the tab has never sent. */
  response: SendResponse | null
  /** Who produced the response currently on screen; agent calls are named in the chrome. */
  responseSource: HistorySource | null
  history: HistoryEntryInfo[]
  /** The picked history entry, or null when the latest/live response is shown. */
  historyId: number | null
  onPickHistory: (id: number) => void
  onClearHistory: () => void
  sending: boolean
  sendingLabel?: string
  /** A failed send — shown as a strip WITHOUT discarding the last good response. */
  sendError: { message: string; detail?: string } | null
}) {
  const contentType = response?.headers['content-type']
  const language = editorLanguage(contentType)

  const prettyText = useMemo(
    () => (response ? (language === 'json' ? formatJsonBody(response.body) : response.body) : ''),
    [response, language],
  )
  const { copy: copyBody } = useCopied()
  const downloadBody = () => {
    if (!response) return
    const blob = new Blob([response.body], {
      type: response.headers['content-type'] || 'text/plain',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${name}.${EXTENSION[language] ?? 'txt'}`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  const notLatest = historyId != null && history.length > 0 && historyId !== history[0]!.id

  const showCookies = (response?.cookies?.length ?? 0) > 0
  const [resTab, setResTab] = useState<ResponseTabId>('body')
  const items = [
    { id: 'body' as const, label: 'Response' },
    {
      id: 'headers' as const,
      label: 'Headers',
      badge: response ? Object.keys(response.headers).length || undefined : undefined,
    },
    ...(showCookies
      ? [
          {
            id: 'cookies' as const,
            label: 'Cookies',
            badge: response!.cookies!.length,
          },
        ]
      : []),
    {
      id: 'timeline' as const,
      label: 'Timeline',
      badge: response && response.hops.length > 1 ? response.hops.length : undefined,
    },
  ]
  // A tab that vanished on the new response (no cookies/redirects this time) falls back to Body.
  const activeTab = items.some((i) => i.id === resTab) ? resTab : 'body'

  return (
    <div
      className="@container flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      aria-busy={sending}
    >
      {/* The RESPONSE is the subject here, not the request: the request tab above publishes a
          failed SAVE under the request's own name, and one subject with two owners means each
          settles the other's Event Center row. */}
      <ApiProblem
        subject={`${name} response`}
        message={sendError?.message}
        detail={sendError?.detail}
        consequence={response ? 'stale' : 'blocked'}
      />

      {response ? (
        <>
          {/* Status readout + response actions ride in TabBar's `trailing` slot: one
              row, one seam, drawn by the primitive. */}
          <TabBar<ResponseTabId>
            aria-label="Response details"
            className="px-1"
            items={items}
            active={activeTab}
            onChange={setResTab}
            trailing={
              <div className="flex shrink-0 items-center gap-2 px-2">
                {sending && <Spinner size="sm" label={sendingLabel} />}
                <span
                  className={cn(
                    'font-mono text-2xs font-semibold',
                    STATUS_TEXT[statusTone(response.status)],
                  )}
                >
                  {`${response.status} ${response.statusText}`.trim()}
                </span>
                {responseSource === 'agent' && (
                  <Chip tone="neutral" className="font-medium">
                    Agent
                  </Chip>
                )}
                <span className="text-2xs text-text-faint @max-md:hidden">
                  {formatMs(response.elapsedMs)}
                </span>
                <span className="text-2xs text-text-faint @max-md:hidden">
                  {formatBytes(response.bytes)}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      size="sm"
                      aria-label="Response history and actions"
                      tooltip={notLatest ? 'Viewing an earlier response' : 'Response actions'}
                      className={cn(notLatest && 'text-status-warning')}
                    >
                      <MoreHorizontal className="size-3.5" />
                    </IconButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-52">
                    {/* The response on view is ONE of the recent ones, so its rows are the
                        kit's `selected` rows — they used to place a `<Check>` by hand in a
                        reserved column of their own. */}
                    <MenuEntries
                      family="dropdown"
                      entries={[
                        { header: 'Response actions' },
                        {
                          id: 'copy-body',
                          label: 'Copy body',
                          icon: Copy,
                          onSelect: () => void copyBody(prettyText),
                        },
                        {
                          id: 'download-body',
                          label: 'Download body',
                          icon: Download,
                          onSelect: downloadBody,
                        },
                        { separator: true },
                        { header: 'Recent responses' },
                        ...(history.length === 0
                          ? [
                              {
                                id: 'no-history',
                                label: 'No previous responses',
                                disabled: true,
                                onSelect: () => {},
                              },
                            ]
                          : history.map((entry, index) => ({
                              id: `history:${entry.id}`,
                              label: `${index === 0 ? 'Latest' : timeOf(entry.at)}${entry.source === 'agent' ? ' · agent' : ''}`,
                              hint: String(entry.response.status),
                              selected: (historyId ?? history[0]?.id) === entry.id,
                              onSelect: () => onPickHistory(entry.id),
                            }))),
                        { separator: true },
                        ...(history.length > 0
                          ? [
                              {
                                id: 'clear-history',
                                label: 'Clear history',
                                icon: Trash2,
                                danger: true,
                                onSelect: onClearHistory,
                              },
                            ]
                          : []),
                      ]}
                    />
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            }
          />

          {response.truncated && (
            <div
              role="status"
              className="flex items-start gap-2 border-b border-border-soft px-3 py-1.5 text-2xs text-text-soft"
            >
              <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">
                Response truncated at {formatBytes(response.bytes)}. Raise the max body size in the
                mini app settings to see the rest.
              </span>
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col">
            {activeTab === 'body' ? (
              <BodySection response={response} language={language} shown={prettyText} />
            ) : (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {activeTab === 'headers' && (
                  <KvTable rows={Object.entries(response.headers)} copyAllLabel="Copy all" />
                )}
                {activeTab === 'cookies' &&
                  (response.cookies && response.cookies.length > 0 ? (
                    <KvTable
                      rows={response.cookies.map((c) => [c.name, c.value] as [string, string])}
                      copyAllLabel="Copy all"
                    />
                  ) : (
                    <EmptyHint>No cookies set.</EmptyHint>
                  ))}
                {activeTab === 'timeline' && (
                  <div className="scrollbar-thin min-h-0 flex-1 overflow-auto p-3">
                    <Timeline hops={response.hops} />
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      ) : sending ? (
        <LoadingHint className="flex-1">{sendingLabel}</LoadingHint>
      ) : (
        <EmptyHint>
          {sendError ? 'The send failed. The report is above.' : 'Send to view the response.'}
        </EmptyHint>
      )}
    </div>
  )
}
