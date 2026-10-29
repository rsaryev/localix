import { Link2 } from 'lucide-react'

/** Overlay revealed by the shell's drop-target styling while an agent link is dragged over. */
export function ComposerDropHint() {
  return (
    <div
      data-agent-link-drop-hint
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-(--z-drag-overlay) flex items-center justify-center gap-2 rounded-[inherit] lx-occluder px-4 text-xs font-medium text-foreground opacity-0"
    >
      <Link2 className="size-4" />
      Drop here to add context to the message
    </div>
  )
}
