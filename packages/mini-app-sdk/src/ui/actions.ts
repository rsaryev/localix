import type { IconComponent, MiniAppOwnedContribution } from './contrib'

/** Content supplied by the host, rather than DOM nodes or a destination's private format. */
export type ActionTarget =
  | { kind: 'code'; text: string; language?: string; title?: string }
  | {
      kind: 'visualization'
      format: string
      source: string
      title?: string
      svg?: string
      width?: number
      height?: number
    }
  | {
      kind: 'markdown'
      markdown: string
      block: 'paragraph' | 'heading' | 'list' | 'quote' | 'callout' | 'math' | 'other'
    }
  | { kind: 'table'; markdown: string }
  | { kind: 'image'; src: string; alt?: string; title?: string; width?: number; height?: number }
  | { kind: 'link'; url: string; title?: string }
  | { kind: 'file'; path: string; line?: number; title?: string }

export interface ActionContext {
  /** The chat that owns the content, never whichever chat happens to be active. */
  sessionId: string
  /** Where the content is being shown, e.g. chat.content, board.element, file.content. */
  surface: string
  target: ActionTarget
}

export interface ActionContribution extends MiniAppOwnedContribution {
  id: string
  label: string
  title?: string
  Icon: IconComponent
  /** Synchronous, cheap and free of side effects; called during rendering and before running. */
  when(context: ActionContext): boolean
  /** Optional live eligibility. The host rechecks `when`; the plugin owns state and I/O. */
  subscribe?(context: ActionContext, onChange: () => void): () => void
  run(context: ActionContext): Promise<{ message?: string } | void>
}
