/**
 * The external-agent session reader: one payload normalization, one resource-URI grammar and one
 * transcript-opening path. Multiple readers could otherwise let a transcript show one thing while
 * handing the agent a ref to another.
 */
import { externalAgentsApi } from '../api/externalAgentsApi'
import { Import as ImportIcon, Terminal } from 'lucide-react'
import { toMessages, type ExternalTranscriptMessage } from './toMessages'
import { setMessageBindingDrag } from '@localixai/plugin-sdk/ui/message-binding-drag'
import {
  localixResourceUri,
  parseLocalixResourceUri,
  pluginProjects,
  pluginSessions,
  pluginTerminal,
  resourceMessageBindingDraft,
  type MessageContextBindingDraft,
} from '@localixai/plugin-sdk/ui'
import { linkKeyOf } from '../../shared/identity'
import { MAX_TRANSCRIPT_EVENTS } from '../../shared/contracts'
import type { RosterRow } from './types'
import { EXTERNAL_AGENT_RESOURCE_PROVIDER } from '../../shared/resource-provider-id'

/** The roster workbench's WorkItemKind — a global singleton (see `register.tsx`). */
export const EXTERNAL_AGENTS_KIND = 'external-agents:workspace'

/**
 * The resource namespace shared with `backend/resource-provider.ts` inside this plugin.
 *
 * It was spelled here as a literal, which made "the same family" a convention rather than a fact:
 * the UI mints `localix://resource/external-agent/…` and the backend's `providerSegments(PROVIDER, …)`
 * has to accept it, so a rename that moved one and not the other would fail silently — the tree keeps
 * working and every URI the UI hands out stops resolving.
 */
export const EXTERNAL_AGENT_NAMESPACE = EXTERNAL_AGENT_RESOURCE_PROVIDER

/** Reserved marker introducing the project level. It keeps a project container distinguishable
 *  from a session leaf by SHAPE and must match the resource provider's segment. */
const PROJECT_SEG = 'cwd'

/** What a session tab is ABOUT. Everything the tab renders, fetches or refers to comes from here. */
export interface ExternalAgentSessionSource {
  readonly provider: string
  readonly nativeSessionId: string
  /** `<provider>:<nativeSessionId>` — the key every backend route takes. */
  readonly key: string
  /** `localix://resource/external-agent/<provider>/<nativeSessionId>`. */
  readonly uri: string
  readonly title: string
  readonly cwd?: string
  readonly terminalId?: string
}

/** What an `external-agent` URI addresses. The four levels the resource provider mints. */
export type ExternalAgentUriTarget =
  | { readonly kind: 'root' }
  | { readonly kind: 'provider'; readonly provider: string }
  | { readonly kind: 'project'; readonly provider: string; readonly cwd: string }
  | { readonly kind: 'session'; readonly provider: string; readonly nativeSessionId: string }

/**
 * Mint a session URI through the SDK builder, never by concatenation: it is the one place that
 * percent-encodes a segment and enforces the length/shape bounds, and a hand-built URI would stop
 * round-tripping the first time a native id carried a slash.
 */
export function externalAgentSessionUri(provider: string, nativeSessionId: string): string {
  return localixResourceUri(EXTERNAL_AGENT_NAMESPACE, [provider, nativeSessionId])
}

/** `undefined` unless the value is a usable identity segment — the URI builder throws on the rest. */
function segment(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value !== '.' && value !== '..'
    ? value
    : undefined
}

/** Guarded so a malformed percent-escape reads as a literal segment rather than throwing. */
function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

/** Read any `external-agent` URI. Returns `null` for every other namespace — the ownership guard
 *  an anchor `resolve` needs so a `localix://resource/db/…` or `localix://resource/trade/…` is never claimed here. */
export function parseExternalAgentUri(uri: string): ExternalAgentUriTarget | null {
  const parsed = parseLocalixResourceUri(uri)
  if (!parsed || parsed.provider !== EXTERNAL_AGENT_NAMESPACE) return null
  const decoded = parsed.segments.map(decodeSegment)
  if (decoded.length === 0) return { kind: 'root' }
  const provider = decoded[0]
  if (!provider) return { kind: 'root' }
  if (decoded.length === 1) return { kind: 'provider', provider }
  if (decoded.length === 3 && decoded[1] === PROJECT_SEG && decoded[2]) {
    return { kind: 'project', provider, cwd: decoded[2] }
  }
  if (decoded.length === 2 && decoded[1]) {
    return { kind: 'session', provider, nativeSessionId: decoded[1] }
  }
  // A shape we never mint. Claiming it as "some session" would invent an identity.
  return null
}

function sourceOf(
  provider: string,
  nativeSessionId: string,
  title?: string,
  cwd?: string,
): ExternalAgentSessionSource {
  return {
    provider,
    nativeSessionId,
    key: linkKeyOf({ provider, nativeSessionId }),
    uri: externalAgentSessionUri(provider, nativeSessionId),
    title: title?.trim() || nativeSessionId,
    ...(cwd ? { cwd } : {}),
  }
}

/**
 * The one reading of a `external-agent-session` payload.
 *
 * A payload arrives from three places — an opener, a RESTORED layout written by an older build,
 * and an anchor `resolve` that only had a URI to go on — so the identity is taken from explicit
 * fields when they are there and recovered from the URI when they are not. `null` means the tab
 * cannot say which session it is about, which the body reports rather than guessing at.
 */
export function normalizeSessionPayload(
  payload: Record<string, unknown> | undefined,
): ExternalAgentSessionSource | null {
  const provider = segment(payload?.provider)
  const nativeSessionId = segment(payload?.nativeSessionId)
  const title = typeof payload?.title === 'string' ? payload.title : undefined
  const cwd = typeof payload?.cwd === 'string' && payload.cwd ? payload.cwd : undefined
  if (provider && nativeSessionId) return sourceOf(provider, nativeSessionId, title, cwd)
  const uri = typeof payload?.uri === 'string' ? parseExternalAgentUri(payload.uri) : null
  if (uri?.kind !== 'session') return null
  return sourceOf(uri.provider, uri.nativeSessionId, title, cwd)
}

/** A roster row's session identity. `null` for a live delegation that has not correlated yet:
 *  it has no native id, so there is nothing on disk to open. */
export function sessionSourceOfRow(row: RosterRow): ExternalAgentSessionSource | null {
  const provider = segment(row.provider)
  const nativeSessionId = segment(row.nativeSessionId)
  if (!provider || !nativeSessionId) return null
  return {
    ...sourceOf(provider, nativeSessionId, row.title, row.cwd),
    ...(row.terminalId ? { terminalId: row.terminalId } : {}),
  }
}

/**
 * The one agent-link a session offers, built from the SAME normalized source the tab renders.
 *
 * Attaching a session to a conversation is an ordinary context ref now — there is no second
 * link store, no per-conversation membership and nothing to unlink. That is why the roster row,
 * the tab's own link button and the tab-drag contribution all end up here.
 */
export function sessionMessageBindingDraft(
  source: ExternalAgentSessionSource,
  bindingSource: MessageContextBindingDraft['source'] = 'plugin',
): MessageContextBindingDraft {
  return resourceMessageBindingDraft({ uri: source.uri, label: source.title }, bindingSource)
}

/**
 * Arm the canonical message-binding transport for a session drag.
 *
 * `plainText` is opted into because nothing else on a roster row's drag owns `text/plain`, and a
 * drop that lands outside Localix should still yield the `@resource:` token rather than nothing.
 */
export function setSessionMessageBindingDrag(
  dataTransfer: DataTransfer,
  source: ExternalAgentSessionSource,
): void {
  const binding = sessionMessageBindingDraft(source, 'drag')
  setMessageBindingDrag(dataTransfer, binding, {
    previewLabel: source.title,
    plainText: binding.target.token,
  })
}

/**
 * A read that is not the whole session must SAY which part it is.
 *
 * Both surfaces that show a foreign transcript are windows onto it — the preview a reader opens and
 * the durable session an import mints — and both used to end wherever the window did, with nothing
 * distinguishing "that is all there was" from "that is all we asked for". Truncation past the wire
 * ceiling is unavoidable; a transcript that looks complete is not.
 *
 * This is Localix's own note, marked as such, never something an agent said. It names the counts and
 * the key so the remainder stays reachable from where the reader already is.
 */
function withTruncationNote(
  messages: ExternalTranscriptMessage[],
  slice: {
    readonly withheld: number
    readonly total: number
    readonly sourceTruncated?: boolean
    readonly readFrom?: 'head' | 'tail'
  },
  key: string,
  lead: string,
): ExternalTranscriptMessage[] {
  // A source the adapter cut short cannot support "the LAST N of M": its own M counts only what
  // fitted, so what looks like the end of the session is the end of the READ. In a real local history's
  // largest transcript the two differ by 7h40m of work.
  if (slice.sourceTruncated) {
    // This said "NOT the end of it", which was true while a tail read stopped at the front of the file
    // and became false the moment tail reads started reading backwards. Both surfaces here ask for the
    // tail, so what they hold IS the end — what is missing is everything before it.
    const tail = slice.readFrom !== 'head'
    return [
      {
        id: `${key}#read-bound`,
        role: 'assistant',
        content:
          `_${lead} \`${key}\` — a window into a session too large for one read (the adapter stops at ` +
          `32 MB). ${
            tail
              ? `These are its LATEST turns. What came before is reachable a window at a time: \`external_agent_sessions { action: "transcript", key: "${key}", from: 0 }\`, raising \`from\` to walk forward.`
              : `These are its FIRST turns. What came after is reachable a window at a time by raising \`from\`: \`external_agent_sessions { action: "transcript", key: "${key}", from: 2000 }\`.`
          }_`,
      },
      ...messages,
    ]
  }
  if (slice.withheld <= 0) return messages
  const read = slice.total - slice.withheld
  /**
   * Whether the two ENDS meet. A head read and this tail read each reach `read` events, so a session
   * longer than both together has a middle neither touches — and pointing only at "the session's
   * opening" leaves it unnamed. Four sessions in a real local history are in that band (11,332 / 8,126 / 5,482
   * / 4,968 events against a 2,000-event read), which is why the sentence branches instead of
   * assuming the opening is the whole remainder.
   */
  const endsMeet = slice.total <= read * 2
  const reach = endsMeet
    ? `read the session's opening with \`external_agent_sessions { action: "transcript", key: "${key}" }\``
    : `walk it a window at a time with \`external_agent_sessions { action: "transcript", key: "${key}", from: 0 }\`, raising \`from\` by ${read.toLocaleString()} each time`
  const note: ExternalTranscriptMessage = {
    id: `${key}#read-bound`,
    role: 'assistant',
    content:
      `_${lead} \`${key}\` — the LAST ${read.toLocaleString()} of ` +
      `${slice.total.toLocaleString()} recorded events. The ${slice.withheld.toLocaleString()} before them ` +
      `are still in the agent's own history; ${reach}._`,
  }
  // At the TOP, because it now describes what follows rather than where the reading stopped. A
  // window onto the end of a session begins mid-work, and a reader who meets that without warning
  // reads a missing assignment as an agent that never had one.
  return [note, ...messages]
}

/**
 * Read a foreign session into a transcript tab of the chat `sessionId` — the roster tab's own.
 * The tab belongs to a chat like every other; opened without one, the host would have to guess
 * which chat's workspace shows it.
 */
export interface ImportedExternalAgentSession {
  readonly id: string
  readonly projectId: string
}

/** Import the bounded tail as a durable Localix session, reporting any missing turns. */
export async function importExternalAgentSession(
  source: ExternalAgentSessionSource,
  deps: {
    items: typeof externalAgentsApi.items
    resolveProjectByPath(path: string): Promise<{ id: string }>
    importSession: typeof pluginSessions.importConversation
  } = {
    items: (key, maxEvents, tail) => externalAgentsApi.items(key, maxEvents, tail),
    resolveProjectByPath: (path) => pluginProjects.resolvePath(path),
    importSession: (input) => pluginSessions.importConversation(input),
  },
): Promise<ImportedExternalAgentSession> {
  const slice = await deps.items(source.key, MAX_TRANSCRIPT_EVENTS, true)
  const project = source.cwd ? await deps.resolveProjectByPath(source.cwd) : undefined
  const session = await deps.importSession({
    title: source.title,
    messages: withTruncationNote(
      toMessages(slice.turns, source.key),
      slice,
      source.key,
      'Imported by Localix from',
    ),
    ...(project ? { projectId: project.id } : {}),
  })
  return { id: session.id, projectId: session.projectId }
}

/** Refresh project routing before the host navigates to an imported conversation. */
export async function importAndPrepareExternalAgentSession(
  source: ExternalAgentSessionSource,
): Promise<ImportedExternalAgentSession> {
  const imported = await importExternalAgentSession(source)
  if (source.cwd) await pluginProjects.refresh().catch(() => {})
  return imported
}

export async function openExternalAgentSession(
  sessionId: string,
  source: ExternalAgentSessionSource,
  loadItems: typeof externalAgentsApi.items = (key, maxEvents, tail) =>
    externalAgentsApi.items(key, maxEvents, tail),
  prepareImport: typeof importAndPrepareExternalAgentSession = (sessionSource) =>
    importAndPrepareExternalAgentSession(sessionSource),
  openTranscript: typeof pluginSessions.openTranscript = (input) =>
    pluginSessions.openTranscript(input),
  spawnCommand: typeof pluginTerminal.spawnCommand = (request) =>
    pluginTerminal.spawnCommand(request),
): Promise<void> {
  // The plugin's entire job: fetch, adapt to our message model, hand it over. Core owns the tab and
  // every pixel in it.
  // The whole session, not a preview-sized slice. It costs nothing: the adapter already walks the
  // source to compute `total`, so 400 events and 2000 measured 52 ms and 53 ms on the same session.
  // From the END for the same reason the import does — a reader opening a foreign session is asking
  // what that agent did, and past the ceiling the opening answers a different question.
  const slice = await loadItems(source.key, MAX_TRANSCRIPT_EVENTS, true)
  const importAction = {
    label: 'Import to Localix',
    pendingLabel: 'Importing…',
    icon: ImportIcon,
    errorLabel: 'Could not import this conversation',
    run: async () => {
      const imported = await prepareImport(source)
      return { sessionId: imported.id, projectId: imported.projectId }
    },
  }
  openTranscript({
    sessionId,
    id: `external-agents:session:${source.key}`,
    title: source.title,
    messages: withTruncationNote(
      toMessages(slice.turns, source.key),
      slice,
      source.key,
      'Localix is showing part of',
    ),
    foreignTools: true,
    action: importAction,
    ...(source.terminalId || slice.resume
      ? {
          actions: [
            importAction,
            {
              label: slice.resume ? `Open in ${slice.resume.providerName}` : 'Open agent terminal',
              pendingLabel: 'Opening…',
              icon: Terminal,
              errorLabel: 'Could not open this agent session in a terminal',
              run: async () => {
                const title = slice.resume?.providerName ?? source.title
                if (source.terminalId) {
                  pluginTerminal.openJob({ sessionId, terminalId: source.terminalId, title })
                } else if (slice.resume) {
                  await spawnCommand({ sessionId, command: slice.resume.command, title })
                }
              },
            },
          ],
        }
      : {}),
  })
}
