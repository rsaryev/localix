import { X } from 'lucide-react'
import { ArrowUpIcon, StopIcon, MicIcon, PaperclipIcon } from './icons'
import { IconButton } from '@localixai/kit/icon-button'
import { PulsingDot } from '@localixai/kit/pulsing-dot'
import { formatTime } from '@/shared/ui/attachments/voiceMessageFormat'
import type { ReactNode } from 'react'

interface ActionButtonsProps {
  hasPrompt: boolean
  canSend: boolean
  isGenerating: boolean
  hasApiKey: boolean
  showAttach?: boolean
  canAttach?: boolean
  onAttachClick?: () => void
  accessory?: ReactNode
  /** Sits after the attach button: the composer's model picker. */
  leading?: ReactNode
  onSend: () => void
  onStop: () => void
  canRecord?: boolean
  isRecording?: boolean
  recordingSeconds?: number
  onMicClick?: () => void
  onCancelRecording?: () => void
  /** Smaller controls for embedded surfaces such as the agent island. */
  compact?: boolean
  /** Replaces the idle voice button, e.g. a link out to the full conversation. */
  idleAction?: ReactNode
}

// The composer's square-action radius: its icon actions deliberately sit on
// `rounded-lg` (softer than IconButton's default) so they read as one family.
const composerActionRadius = 'rounded-lg'
const subtleAction = `${composerActionRadius} text-text-soft disabled:opacity-50`
const solidAction = composerActionRadius
const disabledSolidAction =
  'disabled:bg-surface-active disabled:text-text-faint disabled:opacity-60'

export function ActionButtons({
  hasPrompt,
  canSend,
  isGenerating,
  hasApiKey,
  showAttach = true,
  canAttach = false,
  onAttachClick,
  accessory,
  leading,
  onSend,
  onStop,
  canRecord = false,
  isRecording = false,
  recordingSeconds = 0,
  onMicClick,
  onCancelRecording,
  compact = false,
  idleAction,
}: ActionButtonsProps) {
  const size = compact ? 'sm' : 'lg'
  return (
    <div
      role="group"
      aria-label="Composer actions"
      className="flex items-center justify-between px-2.5 pb-[0.55rem] pt-[0.2rem] max-sm:px-2 max-sm:pb-1.5"
    >
      {/* Left: attach, then the model picker */}
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <div
          role={showAttach ? 'group' : undefined}
          aria-label={showAttach ? 'Attachments' : undefined}
          className="flex items-center gap-1"
        >
          {showAttach && (
            <IconButton
              size={size}
              tooltip="Attach file"
              tooltipSide="top"
              disabled={!canAttach}
              onClick={onAttachClick}
              aria-label="Attach file"
              className={subtleAction}
            >
              <PaperclipIcon className="size-4" />
            </IconButton>
          )}
        </div>
        {leading}
      </div>

      {/* Right: send/stop/mic */}
      <div
        role="group"
        aria-label="Prompt and send actions"
        className="flex min-h-(--chrome-control-lg) items-center gap-1"
      >
        {accessory}

        {isRecording ? (
          <div className="flex items-center gap-1">
            <IconButton
              size={size}
              tooltip="Cancel recording"
              tooltipSide="top"
              onClick={onCancelRecording}
              aria-label="Cancel recording"
              className={subtleAction}
            >
              <X className="size-4" />
            </IconButton>
            <span
              role="timer"
              aria-label={`Recording ${formatTime(recordingSeconds)}`}
              className="flex items-center gap-1.5 px-1 text-xs tabular-nums text-text-strong"
            >
              <PulsingDot className="size-2 text-status-error" />
              {formatTime(recordingSeconds)}
            </span>
            <IconButton
              size={size}
              emphasis="solid"
              tooltip="Stop recording"
              tooltipSide="top"
              onClick={onMicClick}
              aria-label="Stop recording"
              className={solidAction}
            >
              <StopIcon className="size-3.5" />
            </IconButton>
          </div>
        ) : isGenerating && !hasPrompt ? (
          <IconButton
            size={size}
            emphasis="solid"
            tooltip="Stop"
            tooltipSide="top"
            onClick={onStop}
            aria-label="Stop generation"
            className={solidAction}
          >
            <StopIcon className="size-3.5" />
          </IconButton>
        ) : !hasPrompt ? (
          (idleAction ??
          (canRecord && hasApiKey ? (
            <IconButton
              size={size}
              tooltip="Record voice message"
              tooltipSide="top"
              disabled={!hasApiKey || !canRecord}
              onClick={onMicClick}
              aria-label="Voice input"
              className={subtleAction}
            >
              <MicIcon className="size-4" />
            </IconButton>
          ) : null))
        ) : (
          <IconButton
            size={size}
            emphasis="solid"
            tooltip={isGenerating ? 'Queue message' : 'Send'}
            tooltipSide="top"
            disabled={!canSend}
            onClick={onSend}
            aria-label={isGenerating ? 'Queue message' : 'Send'}
            className={`${solidAction} ${disabledSolidAction}`}
          >
            <ArrowUpIcon className="size-4" />
          </IconButton>
        )}
      </div>
    </div>
  )
}
