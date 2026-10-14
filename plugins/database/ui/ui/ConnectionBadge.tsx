import { Lock, Network } from 'lucide-react'
import { DB_BADGE_CAPS } from './dbBadge'

// The RO / SSH tags shown next to a connection's name (the connections tree, a connection's
// header, a .sql file's connection bar). Labelling lives here, styling in `DB_BADGE_CAPS`; callers
// decide WHETHER to render by passing the flags they hold.
export function ConnectionBadges({ readonly, hasSsh }: { readonly?: boolean; hasSsh?: boolean }) {
  return (
    <>
      {readonly && (
        <span title="Read-only — writes are blocked" className={DB_BADGE_CAPS}>
          <Lock className="size-2.5" />
          RO
        </span>
      )}
      {hasSsh && (
        <span title="Connects through an SSH tunnel" className={DB_BADGE_CAPS}>
          <Network className="size-2.5" />
          SSH
        </span>
      )}
    </>
  )
}
