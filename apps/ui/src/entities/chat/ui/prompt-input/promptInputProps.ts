import type { ComposerDropzone } from './useComposerDropzone'
import type { useViewState } from '@/shared/lib/view-state/useViewState'
import type { ReactElement, ReactNode } from 'react'

import type { ChatCacheDiagnosticsPayload, ChatUsagePayload } from '@localixai/agent'
import type { CatalogModel } from '@localixai/agent/catalog'
import type { MessageBinding, SessionLoopSummary, SessionQueueItem } from '@/shared/api/contracts'
import type { AttachmentGate, PendingAttachment } from '@/shared/lib/attachment-policy'
import type { ResolvedTheme } from '@/shared/theme/useTheme'

import type { ContextAttemptSnapshot, ContextWindowDiagnostics } from '../../model/contextUsage'
import type { ReasoningEffort } from '../../model/reasoning'
import type { TipContext } from '../../model/tipSelection'
import type { AmbientTabLink } from './ambientTabLinks'
import type { SystemContextControls } from './ContextRefChips'
import type { useConnections } from './useConnections'

export interface PromptInputProps {
  /** Embedded surfaces (the agent island) own their gutters and use smaller action controls. */
  layout?: 'workspace' | 'embedded'
  /** The island keeps model selection in the workspace. */
  showModelPicker?: boolean
  /** Embedded surfaces can place context controls in their own toolbar, or none. */
  showContextBar?: boolean
  /** Composer tips belong to the workspace; a small surface has no room for them. */
  showTips?: boolean
  accessory?: ReactNode
  /** Shown in place of the voice button while the draft is empty. */
  idleAction?: ReactNode
  dropzone?: ComposerDropzone
  draftState?: ReturnType<typeof useViewState>
  prompt: string
  setPrompt: (v: string) => void
  isGenerating: boolean
  /** Whether this is the single focused warm-mounted chat surface. */
  isFocused: boolean
  activeSessionId: string | null
  activeConnectionId: string | null
  hasConnection: boolean
  model: string
  setModel: (
    connectionId: string,
    modelId: string,
    reasoningEffort?: ReasoningEffort,
    agentId?: string,
  ) => void | Promise<void>
  models: CatalogModel[]
  reasoningEffort: ReasoningEffort
  setReasoningEffort: (v: ReasoningEffort) => void
  resolvedTheme: ResolvedTheme
  usage?: ChatUsagePayload
  latestContextAttempt?: ContextAttemptSnapshot
  contextDiagnostics?: ContextWindowDiagnostics
  sessionUsage?: ChatUsagePayload
  cacheDiagnostics?: ChatCacheDiagnosticsPayload
  runtimePanel?: ReactNode
  /**
   * What the TRANSCRIPT knows for the tip strip: the latest user ask and the tool
   * streaming right now. The session facts a tip may also be gated on are resolved
   * by the composer (`useTipSignals`), off state it already holds.
   */
  tipContext?: Omit<TipContext, 'signals'>
  readOnlyReason?: string
  interactionOverlay?: ReactNode
  hasInteraction?: boolean
  onSend: (textOverride?: string, bindings?: MessageBinding[], isInternal?: boolean) => void
  onStop: () => void
  /** Roll the chat back to a message of yours — what `/rewind` asks for. A surface without it cannot. */
  onRollback?: (messageId: string) => void
  connectionsState: ReturnType<typeof useConnections>
  /** Backend-owned queue: messages waiting behind the in-flight run. */
  serverQueue?: SessionQueueItem[]
  attachments?: PendingAttachment[]
  onAddFiles?: (files: File[]) => void
  onAddVoice?: (blob: Blob, durationMs: number) => void
  onRemoveAttachment?: (id: string) => void
  attachmentGate?: AttachmentGate
  /** Active session loops shown above the composer as a cancelable strip. */
  loops?: SessionLoopSummary[]
  /** Context bar shown above the input; receives the composer's unified context manifest. */
  contextBar?: ReactElement<{ children?: ReactNode }>
  systemContext?: SystemContextControls
  /** Composer edit mode: the original text of the message loaded into the
   *  composer for editing (null = normal compose). Shows the "Editing" banner and
   *  routes submit to `onSubmitEdit` instead of `onSend`. */
  editingOriginalText?: string | null
  /** Cancel editing (× / Esc): parent restores the stashed draft. */
  onCancelEdit?: () => void
  /** Submit while editing: parent persists the change. Returns true if handled. */
  onSubmitEdit?: (text: string) => boolean
  /** The open editor tabs' link candidates (derived from the grid, FRESHEST FIRST) —
   *  shown as dismissible auto chips so what you're looking at rides the send.
   *  Structural twin of `ActiveTabLink[]` (features/workspace-grid). */
  activeTabLinks?: readonly AmbientTabLink[]
}
