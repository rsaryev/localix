// Clickable file-mention chip rendered inside message markdown (and reused by
// the composer). A mention is link-only — clicking opens the file in the
// inspector; it never carried the file's contents into the model context.
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { inspector } from '@/shared/lib/inspectorBus'
import { MENTION_CHIP } from '@/shared/ui/mention-chip'
import { fileIcon } from '@/shared/ui/file-icon/fileIcon'
import { mentionLabel } from '@/shared/lib/fileMention'

export function FileMentionChip({ path }: { path: string }) {
  const { Icon, color } = fileIcon(path)
  // The file opens in the chat whose transcript or tab shows the mention. Outside any chat there is
  // no workspace to open it in, so the chip stays a label rather than guessing one.
  const sessionId = useWorkItemSessionId()
  return (
    <button
      type="button"
      title={sessionId ? `Open ${path}` : path}
      disabled={!sessionId}
      onClick={() => {
        if (sessionId) inspector.openFile({ sessionId, path })
      }}
      className={MENTION_CHIP.link}
    >
      <Icon className={cn('size-3 shrink-0', color)} />
      <span className="truncate">{mentionLabel(path)}</span>
    </button>
  )
}
