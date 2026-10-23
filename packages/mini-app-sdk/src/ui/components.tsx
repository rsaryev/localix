import {
  Suspense,
  createElement,
  type ComponentPropsWithoutRef,
  type ComponentType,
  type ReactNode,
} from 'react'
import type { SortSpec, TableColumn, TableRow } from '@localixai/dataview'
import type { MessageContextBindingDraft, PublishMessageContext } from './contrib'
import type { ProblemRecovery, ProblemReport } from './problems'
import type { PluginCompletionReference } from './runtime-completion-payloads'

export interface PluginEditorPosition {
  line: number
  character: number
}

export interface PluginEditorCompletionItem {
  label: string
  detail?: string
  kind?: number
  insertText?: string
  insertTextFormat?: 'plainText' | 'snippet'
  range?: { start: PluginEditorPosition; end: PluginEditorPosition }
  filterText?: string
  sortText?: string
  preselect?: boolean
  commitCharacters?: string[]
  command?: { id: string; title?: string; arguments?: unknown[] }
  documentation?: string
}

export interface PluginEditorRunContext {
  fullText: string
  selectedText: string
  cursorOffset: number
  formatDocument(): Promise<void>
}

export type EditorRunContext = PluginEditorRunContext

export interface PluginNextEditRequest {
  content: string
  cursorLine: number
  cursorColumn: number
  documentVersion: number
  documentDigest: string
  requestId: string
}

export interface PluginFileTabProps {
  itemId?: string
  path: string
  /** The chat whose workspace the file is read from and saved to — the tab's own. The host's
   *  editor used to fall back to the chat on screen when this was absent. */
  sessionId: string
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
  revealAt?: number
  auxCompletionSource?: (
    text: string,
    position: PluginEditorPosition,
  ) => PluginEditorCompletionItem[] | Promise<PluginEditorCompletionItem[]>
  /** The editor's own anchors for edit prediction; the host adds the shared working set. */
  nextEditContextSource?: (request: PluginNextEditRequest) => PluginCompletionReference[]
  bottomPanel?: ReactNode
  onRun?: (context: PluginEditorRunContext) => void
  bindRunContext?: (get: () => PluginEditorRunContext) => void
  /** Host-specific editor extensions are opaque and only passed through. */
  extensions?: unknown[]
  formatText?: (text: string) => string | Promise<string>
  publishMessageContext?: PublishMessageContext
}

export interface PluginStagedTableChanges {
  updates: { row: TableRow; values: Record<string, string | null> }[]
  inserts: Record<string, string | null>[]
  deletes: TableRow[]
}

export interface PluginTableGridProps {
  columns: TableColumn[]
  rows: TableRow[]
  total: number
  sort?: SortSpec
  onToggleSort(columnId: string): void
  onReachEnd(): void
  onRowActivate?: (index: number) => void
  editable?: boolean
  editableColumns?: Set<string>
  onCellEdit?: (row: TableRow, columnId: string, next: string | null) => void
  onAddRow?: (values: Record<string, string | null>) => void
  onDeleteRow?: (row: TableRow) => void
  showColumnTypes?: boolean
  showColumnIcons?: boolean
  showRowNumbers?: boolean
  showCellActions?: boolean
  allowNullValues?: boolean
  /** Optional structural editing; the consumer owns column data and undo. */
  columnActions?: {
    rename?: (id: string, title: string) => void
    insert?: (id: string, side: 'before' | 'after') => void
    move?: (id: string, direction: 'left' | 'right') => void
    remove?: (id: string) => void
  }
  pkColumns?: Set<string>
  onColumnFilter?: (columnId: string, value: string) => void
  linkColumns?: Set<string>
  onCellLink?: (columnId: string, value: unknown) => void
  onCellFilter?: (columnId: string, value: unknown) => void
  onCommitChanges?: (changes: PluginStagedTableChanges) => Promise<boolean>
  extraRowCopy?: {
    label: string
    toText(columns: TableColumn[], row: TableRow): string
  }
}

export interface PluginContextBindingIconProps {
  /** Complete canonical binding so resource- and file-aware host presentation stays available. */
  binding: MessageContextBindingDraft
  className?: string
}

export interface PluginContextBindingPreviewProps {
  /** Complete canonical binding; the host decides whether and how it can be previewed. */
  binding: MessageContextBindingDraft
  /** The chat whose workspace a path binding is read from — the caller's own; `null` when it
   *  has none, and then a path binding is not read (never from the chat on screen). */
  sessionId: string | null
  className?: string
  /** Optional media geometry; consumers can preserve aspect ratio without reading owned bytes. */
  onIntrinsicSize?: (size: { width: number; height: number }) => void
}

/** Field heights on the chrome ladder's names, as the host Input takes them: `md` 28 / `lg` 32 / `xl` 36. */
export type PluginInputProps = Omit<ComponentPropsWithoutRef<'input'>, 'size'> & {
  size?: 'md' | 'lg' | 'xl'
}

export type PluginTextareaProps = ComponentPropsWithoutRef<'textarea'> & {
  size?: 'md' | 'lg' | 'xl'
}

/**
 * A problem, said in one line, with a button into the host's Event Center where the full report
 * lives. The only problem surface a plugin gets — and the only one it needs.
 */
export interface PluginProblemLineProps {
  report: ProblemReport
  /** Event Center entry to open; the id returned by `toast.problems`. */
  entryId?: string
  /**
   * The ways out, as data. Spread what `useProblemReport` returned and this arrives already filled
   * in with the same list the Event Center row got.
   */
  actions?: readonly ProblemRecovery[]
  className?: string
}

/**
 * A problem that IS the pane — centred, with the report's expected next step (`primary` recovery,
 * e.g. Install Docker) as the surface's button and the line's quiet links under it.
 */
export interface PluginProblemStateProps extends PluginProblemLineProps {
  /** The subject's own icon; defaults to the severity glyph. */
  icon?: ComponentType<{ className?: string; strokeWidth?: number; 'aria-hidden'?: boolean }>
}

export interface PluginUiComponents {
  FileTab: ComponentType<PluginFileTabProps>
  TableGrid: ComponentType<PluginTableGridProps>
  ContextBindingIcon: ComponentType<PluginContextBindingIconProps>
  ContextBindingPreview: ComponentType<PluginContextBindingPreviewProps>
  Input: ComponentType<PluginInputProps>
  Textarea: ComponentType<PluginTextareaProps>
  ProblemLine: ComponentType<PluginProblemLineProps>
  ProblemState: ComponentType<PluginProblemStateProps>
}

let components: PluginUiComponents | null = null

/**
 * Bind the host components; the returned unbind RESTORES whatever was bound before — the same scope
 * rule as `bindPluginUiRuntime`, for the same defect: clearing to null let a binding that ended
 * erase the one it had shadowed, and every later render met "not bound by the host".
 */
export function bindPluginUiComponents(next: PluginUiComponents): () => void {
  const previous = components
  components = next
  return () => {
    if (components === next) components = previous
  }
}

function component<K extends keyof PluginUiComponents>(key: K): PluginUiComponents[K] {
  if (!components) throw new Error('Plugin UI components are not bound by the host')
  return components[key]
}

function render<P extends object>(Component: ComponentType<P>, props: P) {
  return <Suspense fallback={null}>{createElement(Component, props)}</Suspense>
}

/** Host file-editor surface exposed as an SDK-owned component contract. */
export function FileTab(props: PluginFileTabProps) {
  return render(component('FileTab'), props)
}

/** Virtualized data-grid surface exposed without leaking its host implementation. */
export function TableGrid(props: PluginTableGridProps) {
  return render(component('TableGrid'), props)
}

/** The same registry-driven glyph used by the host's context input and message links. */
export function ContextBindingIcon(props: PluginContextBindingIconProps) {
  return render(component('ContextBindingIcon'), props)
}

/**
 * Host-owned preview for a canonical binding: a file's picture or first lines, and a link into the
 * conversation — a session, a message, a tool call (the transcript's own card), a project — as the
 * chat draws it. Kinds with nothing beyond their name render nothing.
 */
export function ContextBindingPreview(props: PluginContextBindingPreviewProps) {
  return render(component('ContextBindingPreview'), props)
}

/** Host form field with the same geometry and states as native Localix surfaces. */
export function Input(props: PluginInputProps) {
  return render(component('Input'), props)
}

/** Host multiline field; plugins keep content behavior while the host owns presentation. */
export function Textarea(props: PluginTextareaProps) {
  return render(component('Textarea'), props)
}

/**
 * The host's problem line. A plugin's failures then look like the host's failures, and reach the
 * same place — which is the whole point of the contract.
 */
export function ProblemLine(props: PluginProblemLineProps) {
  return render(component('ProblemLine'), props)
}

/**
 * The host's pane-level problem. Use it when the failure is the only thing the pane can show; a
 * hand-built centred wrapper is how a "centred" error ended up at the top of the DevOps sidebar.
 */
export function ProblemState(props: PluginProblemStateProps) {
  return render(component('ProblemState'), props)
}
