import type { ReactNode } from 'react'
import {
  Download,
  ExternalLink,
  Pause,
  Play,
  Sparkles,
  Store as StoreIcon,
  X,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { ProgressBar } from '@localixai/kit/progress-bar'
import type {
  ActivityAction,
  ActivityItem,
  ActivityKind,
  UpdateOffer,
} from '@/shared/lib/background-activity/activityItems'
import { MiniAppIcon } from '@/shared/ui/MiniAppIcon'

/**
 * The top of the Event Center: what is running now and the updates on offer. Live — every row is
 * read from its owner on its poke (`useBackgroundActivity`) and updates in place; nothing here is
 * a journal row. A finished job leaves as a fact its owner records ("Installed Sync").
 */

const KIND_ICON: Record<Exclude<ActivityKind, 'package'>, LucideIcon> = {
  'local-model': Sparkles,
  'app-update': Download,
}
const OFFER_ICON: Record<UpdateOffer['id'], LucideIcon> = {
  app: Download,
  store: StoreIcon,
}
const ACTION_ICON: Record<string, LucideIcon> = {
  pause: Pause,
  resume: Play,
  cancel: X,
  store: ExternalLink,
}

function Glyph({ Icon }: { Icon: LucideIcon }) {
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-sm bg-field-fill text-text-soft">
      <Icon className="size-3.5" aria-hidden />
    </span>
  )
}

/** A bar with a value, or — while how far cannot be said — a quiet moving bar with none. */
function Progress({
  name,
  percent,
  status,
}: {
  name: string
  percent: number | null
  status: string
}) {
  return (
    <ProgressBar
      value={percent ?? 100}
      className="h-1 w-24 shrink-0"
      fillClassName={cn(
        'bg-foreground/45',
        percent === null && 'bg-foreground/20 animate-pulse motion-reduce:animate-none',
      )}
      aria-label={`${name} progress`}
      aria-valuemin={0}
      aria-valuemax={100}
      {...(percent === null ? { 'aria-valuetext': status } : { 'aria-valuenow': percent })}
    />
  )
}

function Row({
  icon,
  name,
  detail,
  trailing,
}: {
  icon: ReactNode
  name: string
  detail: string
  trailing: ReactNode
}) {
  return (
    <li className="flex min-h-10 items-center gap-2.5 rounded-sm px-2 py-1.5 hover:bg-surface-hover">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-foreground">{name}</p>
        <p className="truncate text-2xs text-text-faint tabular-nums">{detail}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">{trailing}</div>
    </li>
  )
}

function ItemActions({ actions }: { actions: ActivityAction[] }) {
  return actions.map((action) => {
    const Icon = ACTION_ICON[action.id] ?? ExternalLink
    return (
      <IconButton
        key={action.id}
        size="xs"
        aria-label={action.label}
        tooltip={action.label}
        onClick={() => void action.run()}
      >
        <Icon />
      </IconButton>
    )
  })
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="px-1.5 pt-2 pb-1">
      <h3 className="px-2 pb-1 text-2xs font-medium text-text-faint">{label}</h3>
      <ul className="flex flex-col">{children}</ul>
    </section>
  )
}

export function ActivitySection({
  items,
  updates,
}: {
  items: readonly ActivityItem[]
  updates: readonly UpdateOffer[]
}) {
  if (items.length === 0 && updates.length === 0) return null
  return (
    <div className="mt-2.5 shrink-0 border-y border-border-soft">
      {items.length > 0 && (
        <Group label="In progress">
          {items.map((item) => (
            <Row
              key={item.id}
              icon={
                item.kind === 'package' ? (
                  <MiniAppIcon name={item.name} label={item.name} icon={item.icon} size={24} />
                ) : (
                  <Glyph Icon={KIND_ICON[item.kind]} />
                )
              }
              name={item.name}
              detail={item.status}
              trailing={
                <>
                  {/* Waiting is not 0%: no bar until it starts. */}
                  {item.state !== 'waiting' && (
                    <Progress name={item.name} percent={item.percent} status={item.status} />
                  )}
                  <ItemActions actions={item.actions} />
                </>
              }
            />
          ))}
        </Group>
      )}
      {updates.length > 0 && (
        <Group label="Updates">
          {updates.map((offer) => (
            <Row
              key={offer.id}
              icon={<Glyph Icon={OFFER_ICON[offer.id]} />}
              name={offer.title}
              detail={offer.running?.status ?? offer.detail}
              trailing={
                offer.running ? (
                  <Progress
                    name={offer.title}
                    percent={offer.running.percent}
                    status={offer.running.status}
                  />
                ) : offer.action ? (
                  <Button size="xs" variant="field" onClick={() => void offer.action?.run()}>
                    {offer.action.label}
                  </Button>
                ) : null
              }
            />
          ))}
        </Group>
      )}
    </div>
  )
}
