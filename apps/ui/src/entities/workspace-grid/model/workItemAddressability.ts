import {
  CORE_WORK_ITEM_KINDS,
  type CoreWorkItemKind,
  type WorkItem,
  type WorkItemKind,
} from '@/shared/lib/workItem'
import type { GridNode } from './tree'
import { groupOfTab } from './itemOps'
import { isVisibleInScope } from './scope'

export type WorkItemAddressability =
  | {
      mode: 'direct'
      /** Registered location id, runtime owner, or stable core URI vocabulary. */
      owner: string
    }
  | {
      mode: 'focus-existing'
      locationId: 'work-item.focus'
      /** Why constructing this kind from URL parameters would be unsafe or incomplete. */
      reason: string
    }
  | {
      mode: 'non-addressable'
      /** Kept explicit so a deliberate exception is reviewable and test-visible. */
      reason: string
    }

/**
 * Exhaustive addressability metadata for every host-owned WorkItem kind.
 *
 * Payload-bound views use the generic existing-tab focus location rather than
 * duplicating opaque contents in URLs. A new core kind added to
 * `CORE_WORK_ITEM_KINDS` fails type-check until this table classifies it.
 */
export const CORE_WORK_ITEM_ADDRESSABILITY = {
  chat: { mode: 'direct', owner: 'chat.open' },
  transcript: {
    mode: 'focus-existing',
    locationId: 'work-item.focus',
    reason: 'A transcript is held in memory by whoever opened it; a URI cannot reconstruct one.',
  },
  file: { mode: 'direct', owner: 'file.open' },
  diff: {
    mode: 'focus-existing',
    locationId: 'work-item.focus',
    reason: 'A diff requires an already-trusted patch payload.',
  },
  preview: { mode: 'direct', owner: 'preview.open' },
  'mini-app-view': { mode: 'direct', owner: 'runtime mini-app-view location' },
  'live-file-change': {
    mode: 'focus-existing',
    locationId: 'work-item.focus',
    reason: 'A live mutation stream exists only while its trusted tool call is mounted.',
  },
  stats: { mode: 'direct', owner: 'usage.open' },
  problems: { mode: 'direct', owner: 'problems.open' },
  settings: { mode: 'direct', owner: 'settings.open' },
  terminal: { mode: 'direct', owner: 'terminal.open' },
  'message-replay': { mode: 'direct', owner: 'snapshot.open' },
  'global-search': { mode: 'direct', owner: 'search.open' },
} as const satisfies Record<CoreWorkItemKind, WorkItemAddressability>

const CORE_KIND_SET: ReadonlySet<string> = new Set(CORE_WORK_ITEM_KINDS)

export function isCoreWorkItemKind(kind: string): kind is CoreWorkItemKind {
  return CORE_KIND_SET.has(kind)
}

/**
 * Runtime/mini app kinds inherit the same safe contract: their owner may expose a
 * richer typed location, while every already-mounted tab is at least focusable
 * without core knowing its payload or id grammar.
 */
export function workItemAddressability(kind: WorkItemKind): WorkItemAddressability {
  if (isCoreWorkItemKind(kind)) return CORE_WORK_ITEM_ADDRESSABILITY[kind]
  return {
    mode: 'focus-existing',
    locationId: 'work-item.focus',
    reason: 'Mini-app-owned payloads remain with the mounted contribution.',
  }
}

export interface WorkItemFocusState {
  root: GridNode
  items: Record<string, WorkItem>
  activeScope: string
}

/** Pure fail-closed resolver shared by the runtime surface and deterministic tests. */
export function resolveExistingWorkItemFocus(
  state: WorkItemFocusState,
  id: string,
): { kind: 'work-item-focus'; id: string } | null {
  const item = state.items[id]
  if (!item || !groupOfTab(state.root, id) || !isVisibleInScope(item.scope, state.activeScope)) {
    return null
  }
  return { kind: 'work-item-focus', id }
}
