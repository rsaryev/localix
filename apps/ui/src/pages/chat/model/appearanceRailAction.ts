import { createElement, type ComponentType } from 'react'
import { Moon, Sun, SunMoon } from 'lucide-react'
import { cycleThemeMode, type ThemeMode } from '@/shared/theme/useTheme'
import type { RailAction } from '@/widgets/workspace-shell'

/** The appearance button shows the mode it is IN, so the rail can be read without pressing it. */
const APPEARANCE_ICON: Record<ThemeMode, ComponentType<{ className?: string }>> = {
  dark: Moon,
  light: Sun,
  system: SunMoon,
}

/** Names the current mode and what one press does — the button's only affordance is its tooltip. */
const APPEARANCE_LABEL: Record<ThemeMode, string> = {
  dark: 'Dark appearance — switch to light',
  light: 'Light appearance — follow the system',
  system: 'Following the system — switch to dark',
}

/**
 * The rail's theme toggle. Appearance lives next to Settings because it is the one preference
 * people change often enough to want in reach — and with three values a cycling button is the
 * whole control. The icon shows the CURRENT mode rather than the next one: a control that
 * displays where you are can be read at rest, while one that displays where it will take you
 * can only be read by pressing it.
 */
export function appearanceRailAction(themeMode: ThemeMode): RailAction {
  return {
    id: 'appearance',
    icon: createElement(APPEARANCE_ICON[themeMode], { className: 'size-4.5' }),
    label: APPEARANCE_LABEL[themeMode],
    customizable: true,
    defaultArea: 'bottom' as const,
    onClick: (event) => {
      // The reveal animates out of the button that was pressed, so the origin is the pointer.
      cycleThemeMode(event ? { x: event.clientX, y: event.clientY } : undefined)
    },
  }
}
