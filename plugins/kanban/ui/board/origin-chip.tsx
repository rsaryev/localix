import { Bot, User } from 'lucide-react'
import type { KanbanOrigin } from '../../shared/contracts'

/** `showLabel` off → icon-only (dense cards); on → icon + origin text (detail view). */
export function OriginChip({
  origin,
  showLabel = true,
}: {
  origin: KanbanOrigin
  showLabel?: boolean
}) {
  const Icon = origin === 'user' ? User : Bot
  return (
    <span className="flex items-center gap-0.5" title={`Origin: ${origin}`}>
      <Icon className="size-2.5" /> {showLabel && origin}
    </span>
  )
}
