import type { UiAnchorOpenResult, UiNavigationAction } from '@localixai/mini-app-sdk/ui'
import { parseLocalixUri } from '@localixai/mini-app-sdk/navigation'
import { resolveUiAnchor } from '@/shared/contrib/uiAnchors'
import { hasUiCommand, uiCommandEffect } from '@/shared/contrib/uiCommands'
import { isRegisteredUiLocationUri, resolveUiLocation } from '@/shared/contrib/uiLocations'
import { parseSettingsAnchorUri } from './settingsAnchors'
import { requestUiReveal } from './uiTargetRegistry'

export type UiNavigationTarget = UiAnchorOpenResult

/** One host adapter owns how semantic navigation targets open concrete surfaces. */
export interface UiNavigationHost {
  open(target: UiNavigationTarget, access?: UiInvocationAccess): void
}

export interface UiInvocationAccess {
  /** Reserved for trusted, user-driven UI. Agent-originated actions must omit this. */
  allowWrite?: boolean
}

/** Parse always-present core destinations. Mini app providers remain registry-owned. */
export function parseCoreUiUri(
  uri: string,
  access: UiInvocationAccess = {},
): UiNavigationTarget | null {
  const localix = parseLocalixUri(uri)
  const settings = parseSettingsAnchorUri(uri)
  if (settings) return { kind: 'settings', ...settings }
  if (localix?.primitive === 'ui' && Array.from(localix.query).length === 0) {
    const readCommand = localix.breadcrumbs.length === 2 && localix.breadcrumbs[0] === 'command'
    const writeCommand =
      localix.breadcrumbs.length === 3 &&
      localix.breadcrumbs[0] === 'action' &&
      localix.breadcrumbs[1] === 'command'
    if (readCommand || writeCommand) {
      if (writeCommand && !access.allowWrite) return null
      const commandId = localix.breadcrumbs[writeCommand ? 2 : 1]
      const expectedEffect = writeCommand ? 'write' : 'read'
      if (
        commandId &&
        uiCommandEffect(commandId) === expectedEffect &&
        hasUiCommand(commandId, access.allowWrite)
      ) {
        return { kind: 'command', commandId }
      }
    }
  }
  return null
}

/** One resolution's full result: where it opens, and how the owner presents it. */
interface ResolvedUiNavigation {
  /**
   * Null when the destination resolved but must not be invoked — a registry-owned
   * command whose effect or availability no longer matches. Its copy stays usable, so
   * a disabled button keeps the owner's live label rather than falling back to the
   * serialized one.
   */
  target: UiNavigationTarget | null
  /** Present only for registry-owned destinations; anchors carry no copy. */
  presentation?: { label: string; description?: string }
}

/**
 * Resolve one canonical URI through mini app ownership first, then core namespaces.
 *
 * Resolution is not a lookup: it validates typed arguments and RUNS the owner's
 * `resolve(args)` (and `present(args)`), which allocates a target descriptor. Callers
 * that need both availability and copy must therefore take both from a single call —
 * see `viewUiNavigationAction`.
 */
function resolveUiNavigationDetail(
  uri: string,
  access: UiInvocationAccess = {},
): ResolvedUiNavigation | null {
  const location = resolveUiLocation(uri, access)
  if (location) {
    if (
      location.target.kind === 'command' &&
      (uiCommandEffect(location.target.commandId) !== location.descriptor.effect ||
        !hasUiCommand(location.target.commandId, access.allowWrite))
    ) {
      return { target: null, presentation: location.presentation }
    }
    return { target: location.target, presentation: location.presentation }
  }
  if (isRegisteredUiLocationUri(uri)) return null
  const anchor = resolveUiAnchor(uri)
  if (
    anchor?.kind === 'command' &&
    (uiCommandEffect(anchor.commandId) !== 'read' || !hasUiCommand(anchor.commandId))
  ) {
    return null
  }
  const target = anchor ?? parseCoreUiUri(uri, access)
  return target ? { target } : null
}

export function resolveUiNavigation(
  uri: string,
  access: UiInvocationAccess = {},
): UiNavigationTarget | null {
  return resolveUiNavigationDetail(uri, access)?.target ?? null
}

export function canNavigateUi(uri: string): boolean {
  return resolveUiNavigation(uri) !== null
}

/**
 * The single navigation entry point for clicks, search, `/open`, and agent
 * actions. Surface opening and element reveal intentionally share one URI.
 */
export function navigateUi(uri: string, host: UiNavigationHost): boolean {
  return invokeUi(uri, host)
}

/**
 * Invoke one strict URI intent. Generic/agent callers remain read-only; trusted
 * user-driven surfaces must opt in explicitly before a write intent can resolve.
 */
export function invokeUi(
  uri: string,
  host: UiNavigationHost,
  access: UiInvocationAccess = {},
): boolean {
  const target = resolveUiNavigation(uri, access)
  if (!target) return false
  host.open(target, access)
  requestUiReveal(uri)
  return true
}

/** Execute a serializable action supplied by an agent/tool/message renderer. */
export function navigateUiAction(action: UiNavigationAction, host: UiNavigationHost): boolean {
  return action.type === 'ui.navigate' && navigateUi(action.uri, host)
}

export interface UiNavigationActionView {
  /** Whether a click could resolve right now; a false renders the button disabled. */
  available: boolean
  label: string
  description?: string
}

/**
 * Everything a renderer needs for one serialized action, from ONE resolution.
 *
 * Asking separately for availability and copy resolved the same URI twice per button
 * per render — and a suggestions payload renders up to ten of them, re-running every
 * owner's `resolve(args)` on each registry revision. Live registration still wins over
 * the serialized fallback copy; only the duplicated work is gone.
 */
export function viewUiNavigationAction(action: UiNavigationAction): UiNavigationActionView {
  const resolved = resolveUiNavigationDetail(action.uri)
  const presentation = resolved?.presentation
  const description = presentation ? presentation.description : action.description
  return {
    available: resolved?.target != null,
    label: presentation?.label ?? action.label,
    ...(description ? { description } : {}),
  }
}
