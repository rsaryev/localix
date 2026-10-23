import type { WorkItem } from '@/shared/lib/workItem'
import {
  createMessageBindingDraft,
  type MessageBindingDragPayload,
} from '@localixai/mini-app-sdk/ui/message-binding-drag'
import {
  LIVE_SNIPPET_CONTENT_MAX,
  snippetMessageBindingDraft,
  type WorkItemAgentContext,
} from '@localixai/mini-app-sdk/ui'
import { pluginViewTarget } from '@localixai/api/plugin-view-target'
import { activeWorkItemContribution } from './capabilities'
import { GLOBAL_SCOPE, scopeOf } from './scope'
import { liveTabMessageContext } from './liveTabMessageContext'

function coreMessageBinding(item: WorkItem): MessageBindingDragPayload | null {
  switch (item.kind) {
    case 'file':
    case 'diff': {
      const path = item.payload?.path
      return typeof path === 'string' && path
        ? createMessageBindingDraft('file', path, item.title)
        : null
    }
    case 'terminal': {
      const terminalId = item.payload?.terminalId
      return typeof terminalId === 'string' && terminalId
        ? createMessageBindingDraft('terminal', terminalId, item.title)
        : null
    }
    // Not linkable: nothing in these tabs is a thing the composer can reference.
    case 'agent':
    case 'chat':
    case 'global-search':
    case 'live-file-change':
    case 'message-replay':
    case 'plugin-view':
    case 'preview':
    case 'problems':
    case 'review':
    case 'settings':
    case 'stats':
    // A transcript tab carries only a `transcriptId`, and there is no `transcript` member in
    // `MessageBindingTargetKind` (file | session | project | message | terminal | call |
    // resource | snippet) for it to map to — so it is not linkable TODAY. Whether it should
    // become one (as a `session`, say) is a product call, not a lint fix.
    case 'transcript':
      return null
  }
  return null
}

function staticMessageBindings(item: WorkItem): MessageBindingDragPayload[] {
  const contributed = activeWorkItemContribution(item.kind)
  const context = { session: scopeOf(item.scope) === GLOBAL_SCOPE ? null : scopeOf(item.scope) }
  const many = contributed?.toMessageBindings?.(item, context)
  if (many) return [...many]
  const one = contributed?.toMessageBinding?.(item, context) ?? coreMessageBinding(item)
  return one ? [one] : []
}

function miniAppAgentContext(item: WorkItem): WorkItemAgentContext | null {
  const contribution = activeWorkItemContribution(item.kind)
  const configured = contribution?.agentContext
  if (configured) return typeof configured === 'function' ? configured(item) : configured
  if (!contribution && item.kind !== 'plugin-view') return null
  return {
    description: 'Plugin work item open in the Localix workspace.',
    nextSteps: [
      'Inspect the current view and any selected item.',
      'Ask what outcome the user wants from this plugin.',
      'Use the plugin controls or its advertised tools when more data is needed.',
    ],
  }
}

/** An always-present, bounded snapshot that tells the agent where the user is and what to do next. */
function pluginGuidanceBinding(
  item: WorkItem,
  liveContextAvailable: boolean,
): MessageBindingDragPayload | null {
  const context = miniAppAgentContext(item)
  if (!context) return null
  const owner = activeWorkItemContribution(item.kind)?.pluginName
  const pluginName =
    owner ??
    (typeof item.payload?.pluginName === 'string' ? item.payload.pluginName : undefined) ??
    item.kind.split(':')[0]
  const steps = (context.nextSteps ?? []).slice(0, 3)
  const content = [
    `Active plugin work item: ${item.title}`,
    `Plugin: ${pluginName}`,
    `Surface: ${item.kind}`,
    context.description ? `Purpose: ${context.description}` : null,
    liveContextAvailable
      ? 'Live state: published separately by the active view.'
      : 'Live state: none published yet (the view may be empty, loading, awaiting a selection, or unavailable).',
    context.tools?.length
      ? `Useful agent tools: ${context.tools.join(', ')}`
      : 'Useful agent tools: none advertised; use the visible plugin controls and generic workspace tools.',
    // Said HERE, where the person is looking at the view: "take a screenshot of the plugin" and
    // "click Pods in DevOps" are asked of the tab on screen, and the address is what the agent
    // would otherwise have to guess.
    owner
      ? `See or use this view yourself: the browser tool with url "${pluginViewTarget(owner)}" — snapshot, take_screenshot, steps (click, type).`
      : null,
    steps.length
      ? `Best next steps:\n${steps.map((step, index) => `${index + 1}. ${step}`).join('\n')}`
      : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n')
  return snippetMessageBindingDraft({
    label: `${item.title} — plugin context`,
    content,
    language: 'text',
  })
}

function mergeGuidanceIntoLiveSnippet(
  live: readonly MessageBindingDragPayload[],
  guidance: MessageBindingDragPayload | null,
): MessageBindingDragPayload[] {
  if (!guidance) return [...live]
  const guidanceContent = guidance.target.attributes?.content
  const snippetIndex = live.findIndex(
    (binding) =>
      binding.target.kind === 'snippet' && typeof binding.target.attributes?.content === 'string',
  )
  if (snippetIndex < 0 || typeof guidanceContent !== 'string') return [...live, guidance]
  const boundedGuidance = guidanceContent.slice(0, LIVE_SNIPPET_CONTENT_MAX)
  return live.map((binding, index) =>
    index === snippetIndex
      ? {
          ...binding,
          target: {
            ...binding.target,
            attributes: {
              ...binding.target.attributes,
              content: `${(binding.target.attributes!.content as string).slice(
                0,
                Math.max(0, LIVE_SNIPPET_CONTENT_MAX - boundedGuidance.length - 2),
              )}\n\n${boundedGuidance}`,
            },
          },
        }
      : binding,
  )
}

function dedupeBindings(
  bindings: readonly MessageBindingDragPayload[],
): MessageBindingDragPayload[] {
  const seen = new Set<string>()
  return bindings.filter((binding) => {
    // URI namespaces remain opaque. Identity is the standard target envelope, not a
    // scheme-specific parser in core.
    const key = JSON.stringify({
      kind: binding.target.kind,
      token: binding.target.token,
      uri: binding.target.uri,
      attributes: binding.target.attributes
        ? Object.fromEntries(
            Object.entries(binding.target.attributes).sort(([left], [right]) =>
              left.localeCompare(right),
            ),
          )
        : undefined,
    })
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/**
 * Map an open editor tab to the context-binding draft it links into the composer,
 * so the SAME tab drag that reorders/splits can also be dropped on the chat to reference
 * what you're looking at. Returns null for tabs that aren't linkable (chat/settings/…).
 *
 * - file / diff  → a `@file:<path>` ref (the buffer/diff's file)
 * - terminal     → a `@terminal:<id>` ref (cwd + recent commands + output tail)
 * - a subsystem-contributed kind supplies an opaque `@resource:localix://resource/<provider>/<id>` token and
 *   its OWN mapping via the workItemKind registry. Reserved core kinds keep the
 *   switch below, so a plugin collision cannot replace their binding behavior.
 */
export function workItemToMessageBinding(
  item: WorkItem | undefined,
): MessageBindingDragPayload | null {
  return workItemToMessageBindings(item)[0] ?? null
}

/**
 * All canonical context facets for a tab.
 *
 * Static mappings come from the work-item contribution. A mounted component may
 * publish fresher UI-state facets through the host-injected publisher; `replace`
 * narrows the static target, while `append` enriches it. This is the single merge
 * point used by auto-context and tab dragging, so plugins never coordinate with a
 * composer directly.
 */
export function workItemToMessageBindings(item: WorkItem | undefined): MessageBindingDragPayload[] {
  if (!item) return []
  const statics = staticMessageBindings(item)
  const live = liveTabMessageContext(item.id)
  const guidance = pluginGuidanceBinding(item, Boolean(live))
  if (!live) return ownedBy(item, dedupeBindings(guidance ? [...statics, guidance] : statics))
  const liveWithGuidance = mergeGuidanceIntoLiveSnippet(live.bindings, guidance)
  return ownedBy(
    item,
    dedupeBindings(
      live.strategy === 'replace' ? liveWithGuidance : [...statics, ...liveWithGuidance],
    ),
  )
}

/** The plugin that owns a tab — its contribution's, or a generic plugin view's named owner. */
export function tabOwnerMiniApp(item: WorkItem): string | undefined {
  const owner = activeWorkItemContribution(item.kind)?.pluginName
  if (owner) return owner
  return item.kind === 'plugin-view' && typeof item.payload?.pluginName === 'string'
    ? item.payload.pluginName
    : undefined
}

/**
 * Stamp every binding of a plugin's tab with its owner, so the turn that answers the message
 * carries that plugin's tools — and only while the tab is linked: a closed tab, or a chip the
 * person removed, sends no binding and so brings no tools. The host sets it here, over whatever
 * a plugin's draft said, because this is the one place both the ambient link and a tab drag pass
 * through; a core tab (a file, a terminal) has no owner and carries none.
 */
function ownedBy(
  item: WorkItem,
  bindings: readonly MessageBindingDragPayload[],
): MessageBindingDragPayload[] {
  const plugin = tabOwnerMiniApp(item)
  return bindings.map(({ plugin: _claimed, ...binding }) =>
    plugin ? { ...binding, plugin } : binding,
  )
}
