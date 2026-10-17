import { Button } from '@localixai/kit/button'
import type { AttentionItem } from '@localixai/api/client'
import { ATTENTION_PRESENTATION } from '@/features/chat/ui/attention/presentation'

/**
 * A card assigned to the person (`@human`) or a plan waiting for review. Neither blocks a run, so
 * the island keeps the composer and shows one compact line that opens the conversation.
 */
export function IslandNotice({
  item,
  count,
  onOpen,
}: {
  item: AttentionItem
  count: number
  onOpen: () => void
}) {
  const { icon: Icon, toneClass } = ATTENTION_PRESENTATION[item.kind].badge
  return (
    <div role="group" aria-label="Waiting for you" className="lx-island-notice">
      <Icon aria-hidden className={`size-3.5 shrink-0 ${toneClass}`} />
      <span className="min-w-0 flex-1 truncate">
        {item.title}
        {item.summary && <span className="text-text-soft"> · {item.summary}</span>}
      </span>
      {count > 1 && <span className="shrink-0 text-2xs text-text-soft">+{count - 1}</span>}
      <Button variant="ghost" size="xs" onClick={onOpen}>
        Open chat
      </Button>
    </div>
  )
}
