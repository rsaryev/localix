import { Check, Code, Copy, Eye } from 'lucide-react'
import { useCopied } from '@localixai/mini-app-sdk/ui/interactions'
import { ActionPill } from '@localixai/kit/action-pill'
import { COPIED_FEEDBACK_SHORT_MS } from '@/shared/lib/timings'

// The pill moved to shared/ui (CommentsManager needs it and cannot import from
// features/). Re-exported so the viewer's own toolbars keep their one import.
export { ActionPill }

/** Pinned copy-contents action for the file viewer (CodeBlock's own copy is
 *  hidden in `bare` mode), with transient feedback. */
export function CopyContentButton({ text }: { text: string }) {
  // Shared hook: catches clipboard failures (insecure context / denied) and clears
  // its reset timer on unmount — same robustness as CodeBlock's copy.
  const { copied, copy } = useCopied(COPIED_FEEDBACK_SHORT_MS)
  return (
    <ActionPill title="Copy file contents" onClick={() => void copy(text)}>
      {copied ? <Check className="size-3 text-status-success" /> : <Copy className="size-3" />}
      {copied ? 'Copied' : 'Copy'}
    </ActionPill>
  )
}

/** Rendered ⇄ raw-source toggle, shared by the markdown and SVG viewers. */
export function SourceToggle({
  showSource,
  onToggle,
}: {
  showSource: boolean
  onToggle: () => void
}) {
  return (
    <ActionPill title={showSource ? 'Show rendered' : 'Show raw source'} onClick={onToggle}>
      {showSource ? <Eye className="size-3" /> : <Code className="size-3" />}
      {showSource ? 'Rendered' : 'Source'}
    </ActionPill>
  )
}
