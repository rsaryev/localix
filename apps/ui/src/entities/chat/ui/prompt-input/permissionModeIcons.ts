import { createElement } from 'react'
import { ClipboardList, ShieldCheck, ShieldOff, Zap, type LucideIcon } from 'lucide-react'
import type { IconComponent } from '@localixai/mini-app-sdk/ui'
import type { PermissionMode } from '@localixai/api/permission-modes'

/**
 * How a permission mode is DRAWN, in one place. The composer's mode control and a plan's
 * "Approve ▾" both list modes; two maps let one of them show a shield where the other shows a
 * bolt for the same choice.
 *
 * The looser the mode, the louder its tone — a session left autonomous must not look default.
 */
export const PERMISSION_MODE_PRESENTATION: Record<
  PermissionMode,
  { icon: LucideIcon; tone: string }
> = {
  default: { icon: ShieldCheck, tone: 'text-text-soft' },
  plan: { icon: ClipboardList, tone: 'text-status-info' },
  bypass: { icon: ShieldOff, tone: 'text-status-warning' },
  autonomous: { icon: Zap, tone: 'text-status-error' },
}

/**
 * The mode's icon already IN its tone, for a described menu row.
 *
 * A menu entry's `icon` is drawn by the kit with no class of the caller's, so a bare `ShieldOff`
 * rendered in the row's neutral ink — and the two lists of modes (the composer's menu and
 * "Approve ▾") showed Bypass and Autonomous as quiet as Default, the one thing the tone is for.
 * Built once per mode at module scope, so a row keeps the same component across renders.
 */
function toned(Icon: LucideIcon, tone: string): IconComponent {
  const Toned = ({ className }: { className?: string }) =>
    createElement(Icon, {
      className: className ? `${tone} ${className}` : tone,
      'aria-hidden': true,
    })
  Toned.displayName = `Toned(${Icon.displayName ?? 'Icon'})`
  return Toned
}

export const PERMISSION_MODE_MENU_ICON = Object.fromEntries(
  Object.entries(PERMISSION_MODE_PRESENTATION).map(([mode, { icon, tone }]) => [
    mode,
    toned(icon, tone),
  ]),
) as Record<PermissionMode, IconComponent>
