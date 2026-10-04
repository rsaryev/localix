import type { AddressableResource } from '../resource'
import { parseLocalixUri } from '../navigation'
export {
  localixResourceUri,
  localixUiUri,
  localixUri,
  parseLocalixUri,
  settingsEntityAnchor,
  settingsEntityUiUri,
  settingsUiUri,
} from '../navigation'
import type { IconComponent, PluginOwnedContribution } from './contrib'

/** A provider-neutral item addressable from the UI (settings, a tab, or a backend resource). */
export type UiAnchorNode = AddressableResource

export interface UiAnchorWorkItem {
  kind: 'work-item'
  workKind: string
  id: string
  title: string
  payload?: Record<string, unknown>
  /**
   * The chat session a session-scoped tab belongs to. A tool knows its session
   * (`context.session.id`) and puts it in the URI; the anchor that resolves the URI returns it
   * here. Without it the tab opens in the chat the navigation was started FROM (the transcript or
   * tab the link was followed in) — never in whichever chat happens to be on screen, which once
   * put a board a tool opened for chat A into chat B. With neither, a session kind does not open.
   * Ignored for a global kind.
   */
  session?: string
}

/**
 * Focus an exact tab that is already mounted in the current workspace scope.
 *
 * Unlike `work-item`, this target can never construct a tab or carry its opaque
 * payload. It is the safe address for payload-bound views such as diffs,
 * tool HTML, live mutation streams, document tables, and plugin-owned editors.
 */
export interface UiAnchorWorkItemFocus {
  kind: 'work-item-focus'
  id: string
}

/** Navigate to an existing chat session through the host router. */
export interface UiAnchorSession {
  kind: 'session'
  sessionId: string
}

export interface UiAnchorProject {
  kind: 'project'
  projectId: string
}

export interface UiAnchorMessage {
  kind: 'message'
  sessionId: string
  messageId?: string
}

/**
 * Open a workspace file, optionally revealing a 1-indexed line — and, with `column` and an end,
 * SELECTING that exact span (1-indexed line and column throughout), so an agent that says "this
 * call here" can show the person the call, not the line it is on.
 */
export interface UiAnchorFile {
  kind: 'file'
  /** The chat whose workspace the file opens in; else the chat the navigation started from. */
  session?: string
  path: string
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
}

export interface UiAnchorRailSection {
  kind: 'rail-section'
  /** `null` is the workspace's root/history sidebar. */
  sectionId: string | null
}

export interface UiAnchorSettings {
  kind: 'settings'
  tab: string
  anchor?: string
  /** Optional stable entry id for nested settings surfaces. */
  entryId?: string
  /** Exact capability scope: empty means sessions without a project. */
  scope?: string
}

export type UiAnchorInspector =
  | {
      kind: 'inspector'
      target: 'global-search'
      query?: string
      searchScope?: string
    }
  | {
      kind: 'inspector'
      target: 'terminal'
      sessionId?: string
      terminalMode?: 'reuse' | 'new'
      /**
       * Program to run in the pane instead of an interactive shell — a terminal PROFILE.
       *
       * The host stays agnostic about what this launches: it is a command string supplied by
       * whoever registered the location, exactly as the preview panel already supplies a dev-server
       * command. That is what lets a plugin contribute "open a terminal running X" without the host
       * learning a vocabulary of X's.
       *
       * Reaching this field means the location declared `effect: 'write'`, which the registry binds
       * to `surface: 'action'`, refuses to expose to the agent, and resolves only for a caller that
       * passed `allowWrite`. A command therefore cannot arrive from a model-authored URI.
       */
      command?: string
      /** Tab title for a command pane; without it the tab would be named after a shell it is not. */
      title?: string
    }
  | {
      kind: 'inspector'
      target: 'message-replay'
      sessionId: string
      messageId: string
    }
  | {
      kind: 'inspector'
      target: 'stats'
    }

export interface UiAnchorCommand {
  kind: 'command'
  commandId: string
  /**
   * Arguments already normalized by the owning location's strict query schema.
   * Commands never parse a URI themselves and must not accept unvalidated URL data.
   */
  params?: Readonly<Record<string, UiAnchorOverlayParam>>
}

export interface UiAnchorModelPicker {
  kind: 'model-picker'
  sessionId?: string
  query?: string
  providerId?: string
}

export type UiAnchorOverlayParam = string | number | boolean | readonly string[]

/**
 * Open a frontend-owned transient surface. The id and parameters stay opaque to
 * the SDK; the mounted UI owner interprets them without exposing its contents.
 */
export interface UiAnchorOverlay {
  kind: 'overlay'
  overlayId: string
  params?: Readonly<Record<string, UiAnchorOverlayParam>>
}

/**
 * Serializable action that any agent/tool/message renderer can offer without
 * knowing which Localix surface owns the destination. The host resolves `uri`
 * through the same navigation registry used by search, `/open`, and UI clicks.
 */
export interface UiNavigationAction {
  type: 'ui.navigate'
  uri: string
  label: string
  description?: string
}

/**
 * A one-shot request to reveal a read-only destination immediately after the
 * owning tool succeeds. The transcript still renders a button, so a user can
 * reopen it later; `issuedAt` prevents replaying an old persisted tool result.
 */
export interface UiNavigationRequest {
  type: 'ui.navigate.request'
  uri: string
  label: string
  description?: string
  issuedAt: number
}

/**
 * Bounded set of read-only destinations produced by catalog search. The host
 * renders every entry as a user-driven choice; merely returning this payload
 * never opens a surface.
 */
export interface UiNavigationSuggestions {
  type: 'ui.navigate.suggestions'
  suggestions: readonly UiNavigationAction[]
}

function isReadOnlyNavigationUri(uri: string): boolean {
  const parsed = parseLocalixUri(uri)
  if (!parsed || parsed.breadcrumbs.length < 2) return false
  if (parsed.primitive === 'resource') return true
  return parsed.primitive === 'ui' && parsed.breadcrumbs[0] !== 'action'
}

function hasNavigationPresentation(value: Record<string, unknown>): boolean {
  return (
    typeof value.uri === 'string' &&
    value.uri.length > 0 &&
    isReadOnlyNavigationUri(value.uri) &&
    typeof value.label === 'string' &&
    value.label.trim().length > 0 &&
    value.label.length <= 120 &&
    (value.description === undefined ||
      (typeof value.description === 'string' &&
        value.description.trim().length > 0 &&
        value.description.length <= 240))
  )
}

/** Runtime boundary guard for a user-driven serialized tool/plugin destination. */
export function isUiNavigationAction(value: unknown): value is UiNavigationAction {
  if (!value || typeof value !== 'object') return false
  const action = value as Record<string, unknown>
  return action.type === 'ui.navigate' && hasNavigationPresentation(action)
}

/** Runtime boundary guard for a fresh, automatic, read-only navigation request. */
export function isUiNavigationRequest(value: unknown): value is UiNavigationRequest {
  if (!value || typeof value !== 'object') return false
  const request = value as Record<string, unknown>
  return (
    request.type === 'ui.navigate.request' &&
    hasNavigationPresentation(request) &&
    typeof request.issuedAt === 'number' &&
    Number.isSafeInteger(request.issuedAt) &&
    request.issuedAt > 0
  )
}

/** Runtime boundary guard for a bounded, duplicate-free destination list. */
export function isUiNavigationSuggestions(value: unknown): value is UiNavigationSuggestions {
  if (!value || typeof value !== 'object') return false
  const payload = value as Record<string, unknown>
  if (
    payload.type !== 'ui.navigate.suggestions' ||
    !Array.isArray(payload.suggestions) ||
    payload.suggestions.length === 0 ||
    payload.suggestions.length > 10
  ) {
    return false
  }
  const uris = new Set<string>()
  for (const suggestion of payload.suggestions) {
    if (!isUiNavigationAction(suggestion) || uris.has(suggestion.uri)) return false
    uris.add(suggestion.uri)
  }
  return true
}

export type UiNavigationOutput = UiNavigationAction | UiNavigationRequest | UiNavigationSuggestions

/** Shared discriminator for transcript renderers and other provider boundaries. */
export function isUiNavigationOutput(value: unknown): value is UiNavigationOutput {
  return (
    isUiNavigationAction(value) || isUiNavigationRequest(value) || isUiNavigationSuggestions(value)
  )
}

export type UiAnchorOpenResult =
  | UiAnchorWorkItem
  | UiAnchorWorkItemFocus
  | UiAnchorSession
  | UiAnchorProject
  | UiAnchorMessage
  | UiAnchorFile
  | UiAnchorRailSection
  | UiAnchorSettings
  | UiAnchorInspector
  | UiAnchorCommand
  | UiAnchorModelPicker
  | UiAnchorOverlay

/**
 * One contribution to the shared UI-anchor namespace. `resolve` purely maps opaque URIs to
 * host navigation; optional `listChildren` adds client-only nodes to `/open`.
 * Backend resource providers remain the source for data-backed resource trees.
 */
export interface UiAnchorContribution extends PluginOwnedContribution {
  id: string
  /** Localix URI namespaces exclusively owned by this contribution. Collisions are rejected. */
  namespaces: readonly string[]
  /** Glyph vocabulary for resources in the owned namespaces. Registered atomically by the host. */
  icons?: Record<string, IconComponent>
  resolve(uri: string): UiAnchorOpenResult | null
  listChildren?(parentUri: string | null, query?: string): UiAnchorNode[]
}
