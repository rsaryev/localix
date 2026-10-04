export * from './message-bindings'
import type { MessageContextBindingDraft } from './message-bindings'
import type { ComponentType, LazyExoticComponent } from 'react'

/**
 * Workbench UI contribution contracts. The host (`apps/ui`) implements the open
 * registries these describe; a plugin's `ui/register.tsx` receives them through
 * the {@link PluginUiHost} argument and registers its WorkItem kinds, rail
 * sections/viewlets, search domain, resource icons, and file editors.
 */

/** Any icon component the host can render with a className (Lucide icons qualify). */
export type IconComponent = ComponentType<{ className?: string }>

/** Host-assigned owner for a bundled plugin contribution. Plugin code never sets it. */
export interface PluginOwnedContribution {
  pluginName?: string
}

/** Minimal shape the per-kind hooks below read off a work item — kept structural so
 *  this contract never imports the host's `workspace-grid` feature (the editor-grid
 *  passes a real `WorkItem`, a superset). */
export interface WorkItemLike {
  kind: string
  id: string
  title: string
  /** Host-assigned workspace scope; opaque to the plugin. */
  scope?: string
  payload?: Record<string, unknown>
}

/**
 * What the host knows about a tab that its item does not say plainly.
 *
 * A session-scoped tab's resource usually names its chat (one chat's board, one chat's game), and
 * the binding seam hands the plugin the item alone — so plugins decoded the host's `scope` field,
 * which is opaque by contract (a global tab's scope is a reserved marker, not a session). The host
 * states the session here instead: the chat a session-scoped tab belongs to, or null for a global
 * tab.
 */
export interface WorkItemBindingContext {
  session: string | null
}

/**
 * Stable agent-facing guidance for a contributed work item.
 *
 * This is deliberately metadata rather than a chat implementation hook: the host
 * turns it into ambient context whenever the work item is open, including while
 * its component is loading or has no resource snapshot to publish yet.
 */
export interface WorkItemAgentContext {
  /** Short explanation of what the user can inspect or change on this surface. */
  description?: string
  /** Exact agent tools that are useful from this surface (without prose or arguments). */
  tools?: readonly string[]
  /** One to three concrete, ordered suggestions for continuing from this surface. */
  nextSteps?: readonly string[]
}

export interface WorkItemKindContribution extends PluginOwnedContribution {
  /** The contributed `WorkItemKind` string (a registered subsystem tab kind). */
  kind: string
  /** Grid tab component; may be lazy. Rendered by the editor-grid registry.
   *  `any` is deliberate at this seam: contributions take a SUBSET of the standard
   *  WorkItemBody props ({ item }, or { item, visible, focused, resolvedTheme }), and
   *  contravariance rejects every honest common type for both sides. */
  // oxlint-disable-next-line typescript/no-explicit-any
  Component: ComponentType<any> | LazyExoticComponent<any>
  /** Tab / work-item icon. */
  Icon: IconComponent
  /** Whether the work item is restored across reloads. */
  restorable?: boolean
  /**
   * Placement scope. Omitted = 'session': the tab belongs to the chat its opener names. 'global'
   * is only for an APP-LEVEL surface that reads no session at all — it is visible in every chat
   * and `useWorkItemSessionId()` is null inside it, so a kind that acts for a chat (inserts into
   * a composer, opens files, calls a backend for a session) must be 'session'.
   */
  scope?: 'global' | 'session'
  /**
   * Optional text-color class for this kind's tab-strip icon, derived from the item
   * (e.g. a database connection's color tag).
   */
  iconTint?: (item: WorkItemLike) => string | null | undefined
  /**
   * Agent-facing ambient guidance retained for the whole lifetime of an open tab.
   * A function may specialize the guidance from the work item's opaque payload.
   */
  agentContext?: WorkItemAgentContext | ((item: WorkItemLike) => WorkItemAgentContext)
  /**
   * Optional map from this tab to the architecture-neutral binding draft linked
   * into a message when the tab is dragged or auto-linked.
   */
  toMessageBinding?: (
    item: WorkItemLike,
    context: WorkItemBindingContext,
  ) => MessageContextBindingDraft | null
  /**
   * Optional multi-facet static form. Used by auto-context when one tab naturally
   * exposes several independently resolvable resources. The first binding remains
   * the tab-drag binding; `toMessageBinding` is the single-binding form.
   */
  toMessageBindings?: (
    item: WorkItemLike,
    context: WorkItemBindingContext,
  ) => readonly MessageContextBindingDraft[]
  /**
   * Optional "sibling group" key: when a NEW tab of this kind opens and other tabs share
   * the returned key (by id === key or id starts with `key:`), the grid numbers it
   * ("name", "name 2", …). Return null to opt out.
   */
  siblingGroupKey?: (item: WorkItemLike) => string | null
  /**
   * Which of the workspace's two default areas this kind opens into.
   *
   * Contributions land in the primary `editor` area unless they say otherwise, which is right for
   * a document-shaped surface and wrong for a conversation-shaped one: chats stack in the `aux`
   * side panel, so a transcript that opened center stage read as "somewhere else" no matter how
   * faithfully it rendered. Declaring it here keeps core from having to recognise any particular
   * plugin's kind.
   *
   * The user's own arrangement always wins — this only decides where a kind lands the first time.
   */
  placement?: 'editor' | 'aux'
}

export interface RailSectionContribution extends PluginOwnedContribution {
  /** The rail section id — also this subsystem's `SectionId` in the URL surface. */
  id: string
  title: string
  Icon: IconComponent
  /** Sidebar component rendered when the rail section is active (same seam rationale
   *  as `Component` above). */
  // oxlint-disable-next-line typescript/no-explicit-any
  Sidebar: ComponentType<any>
  /** Optional command-palette label (e.g. 'Show Docker'). When set, the host generates
   *  a generic `view.<id>` "Show …" palette command from this contribution. */
  paletteLabel?: string
  /** Search keywords for the generated palette command. */
  keywords?: string[]
  /** Optional always-mounted, render-null lifecycle component for the subsystem
   *  (e.g. tearing down resources when a tab closes). The host renders one instance
   *  of each contributed `Mount` at composition. */
  Mount?: ComponentType
}

/**
 * A rail VIEWLET (distinct from a rail SECTION): a single rail BUTTON that opens —
 * or, when its tab is focused, toggles closed — a GLOBAL singleton editor-grid tab
 * of the given WorkItemKind. A viewlet may also carry an always-mounted `Mount`
 * (e.g. a client-side data publisher feeding its tab).
 */
export interface RailViewletContribution extends PluginOwnedContribution {
  /** The GLOBAL singleton `WorkItemKind` this button opens (also its stable tab id). */
  kind: string
  Icon: IconComponent
  /** Rail-button tooltip. */
  label: string
  /** Tab title shown when the viewlet opens. */
  title: string
  /** Where the rail button seeds before the user customizes the rail. */
  defaultArea: 'bar' | 'overflow'
  /** Optional keybinding id whose live chord annotates the rail tooltip. */
  chordId?: string
  /** Search keywords for the generated `view.<kind>` "Open …" palette command. */
  keywords?: string[]
  /** Optional always-mounted, render-null lifecycle component (e.g. the publisher
   *  that feeds this viewlet's tab). The host renders one instance at composition. */
  Mount?: ComponentType
}

/**
 * A component the host mounts INSIDE one of its own composed surfaces — a named hole in a host
 * layout rather than a whole tab.
 *
 * At most ONE contribution wins per slot, and the host keeps the first: a slot is a single
 * physical position in a layout, so two providers cannot both occupy it and a silent race for it
 * would be worse than a documented winner.
 */
export interface WorkItemSlotContribution extends PluginOwnedContribution {
  /**
   * The host slot being filled, `<area>.<name>` by convention (`diff.interactive`,
   * `diff.provenance`). The host defines the vocabulary; an unknown slot renders nothing.
   */
  slot: string
  /** Rendered in the slot. Props come from whichever host surface owns it.
   *  `any` for the same contravariance reason WorkItemKindContribution documents above. */
  // oxlint-disable-next-line typescript/no-explicit-any
  Component: ComponentType<any>
}

/**
 * A component mounted for the CURRENT SESSION at a named place in the shell — a background poller,
 * a composer context strip, a breadcrumb action.
 *
 * Unlike a slot, EVERY contribution to a surface renders: these are additive (two plugins may
 * both want a breadcrumb action), and the host keys them by owning plugin so ordering stays
 * stable across reloads.
 */
/**
 * What the host hands a session surface: the session that surface belongs to — the chat whose
 * composer, transcript or breadcrumb it sits in — plus whatever that surface's own host code passes
 * along (`chat.background` sends `{ focused }`, others send their own shape). A surface acts for
 * THIS session; there is no other one to ask for.
 *
 * Named here because a contribution that types its component as `ComponentType<any>` still owes
 * its AUTHOR a real signature — without this every surface re-declared the props inline and drifted
 * from `SessionSurface`, which is the single place that decides them.
 */
export interface SessionSurfaceProps {
  /** The session the surface belongs to, or null where it sits outside any chat. */
  sessionId: string | null
  /** Surface-specific payload; narrow it with a type guard at the use site. */
  context?: unknown
}

export interface SessionSurfaceContribution extends PluginOwnedContribution {
  /**
   * The shell surface, `<area>.<name>` by convention (`chat.background`, `composer.context`,
   * `composer.header` — a strip above the composer, passed `{ isFocused }` — and
   * `breadcrumb.trailing`).
   */
  surface: string
  /** Rendered with the session it belongs to and whatever context that surface passes along.
   *  `any` for the same contravariance reason WorkItemKindContribution documents above. */
  // oxlint-disable-next-line typescript/no-explicit-any
  Component: ComponentType<any>
}
