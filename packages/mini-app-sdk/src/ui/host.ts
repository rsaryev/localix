import type {
  RailSectionContribution,
  RailViewletContribution,
  SessionSurfaceContribution,
  WorkItemKindContribution,
  WorkItemSlotContribution,
} from './contrib'
import type { IconComponent } from './contrib'
import type { SearchDomainContribution } from './search'
import type {
  FileEditorContribution,
  FileEditorEnhancerContribution,
  FileTreeDecorationContribution,
} from './editors'
import type { DedicatedViewerType } from './file-types'
import type { UiAnchorContribution } from './anchors'
import type { UiLocationContribution, UiLocationParamSchema } from './locations'
import type { StatusItemContribution } from './status-items'
import type { ToolCardContribution } from './tool-cards'
import type { CommentActionContribution } from './comment-actions'
import type { ActionContribution } from './actions'

/** Trusted build-time SVG data for an exact-name file icon contribution. */
export interface FileIconData {
  body: string
  width?: number
  height?: number
}

/**
 * The registration surface the host passes to a plugin's `registerUi(host)`.
 * One narrow façade over the host's open registries — a plugin registers its
 * contributions through this instead of importing host registry modules, so an
 * externally-loaded UI (a future dynamic loader) can hand a plugin the same
 * object. The host builds the singleton adapter over its real registries.
 */
export interface MiniAppUiHost {
  /** Editor-grid WorkItem tab kinds. */
  workItems: { register(contribution: WorkItemKindContribution): void }
  /** Left-rail sections (sidebar + URL section id). */
  railSections: { register(contribution: RailSectionContribution): void }
  /** Rail viewlets (single button → global singleton grid tab). */
  railViewlets: { register(contribution: RailViewletContribution): void }
  /** Search domain (scope atom and result icons). */
  search: { register(contribution: SearchDomainContribution): void }
  /** URI-addressable UI targets shared by search, `/open`, and future surfaces. */
  anchors: { register(contribution: UiAnchorContribution): boolean }
  /** Parameterized UI places rebuilt in memory during frontend discovery. */
  locations: {
    register<const TParams extends UiLocationParamSchema>(
      contribution: UiLocationContribution<TParams>,
    ): boolean
  }
  /** Composer @-reference resource glyphs (`resourceIcon` hint → icon). */
  resourceRefIcons: { register(entries: Record<string, IconComponent>): void }
  /** Exact file name → trusted, packaged SVG data. */
  fileIcons: { register(name: string, data: FileIconData): void }
  /** Specialised file-type editors (predicate + component). */
  fileEditors: { register(contribution: FileEditorContribution): void }
  /** File extension → content-type/viewer routing owned by this plugin. */
  fileFormats: { register(entries: Record<string, DedicatedViewerType>): void }
  /**
   * Session-stream event handlers for event types CORE does not route itself
   * (e.g. a plugin backend's own `<domain>.updated` frames). Dispatched by the
   * chat runtime after its built-in routes; a handled type does not reach the
   * generic store reducer. Handlers must be idempotent per (sessionId, event).
   */
  sessionEvents: {
    register(type: string, handler: (sessionId: string, event: unknown) => void): void
  }
  /**
   * A named hole in a surface the HOST lays out — `diff.interactive`, `diff.provenance` — rather
   * than a surface of the plugin's own. The host owns the vocabulary; an unknown slot renders
   * nothing, and at most one contribution wins per slot.
   */
  workItemSlots: { register(contribution: WorkItemSlotContribution): void }
  /**
   * A component mounted for the LIFETIME of a chat session at a host-named position
   * (`chat.background` for a render-null poller, `composer.context`, `breadcrumb.trailing`).
   */
  sessionSurfaces: { register(contribution: SessionSurfaceContribution): void }
  /** Extra chrome injected into the file editor for files this plugin claims (git history, blame). */
  fileEditorEnhancers: { register(contribution: FileEditorEnhancerContribution): void }
  /** Per-path badges in the file tree, indexed once per session (VCS status and the like). */
  fileTreeDecorations: { register(contribution: FileTreeDecorationContribution): void }
  /**
   * An item in the workbench's persistent chrome — the titlebar cluster or the status bar.
   * Declarative: the plugin supplies a hook returning what to show, the host owns the control.
   */
  statusItems: { register(contribution: StatusItemContribution): void }
  /** How the plugin's own tools read in the transcript: presentation, and optionally a card. */
  toolCards: { register(contribution: ToolCardContribution): void }
  /** What else a batch of review comments can become, beside "Send to the agent". */
  commentActions: { register(contribution: CommentActionContribution): void }
  /** Optional for older hosts; contextual actions for typed content on host-owned surfaces. */
  actions?: { register(contribution: ActionContribution): void }
}
