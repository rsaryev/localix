import {
  Puzzle,
  Gauge,
  Activity,
  BarChart3,
  LayoutDashboard,
  Table,
  List,
  Database,
  Box,
  Terminal,
  LineChart,
  PieChart,
  Bell,
  Zap,
  type LucideIcon,
} from 'lucide-react'

/**
 * Resolve a third-party view's optional Lucide icon-NAME hint to a real glyph.
 * A curated allow-list (not the whole lucide surface — that would bloat the
 * bundle and let a manifest name any of hundreds of icons); anything unknown or
 * absent falls back to the generic Puzzle plugin glyph.
 */
const VIEW_ICONS: Record<string, LucideIcon> = {
  gauge: Gauge,
  activity: Activity,
  'bar-chart': BarChart3,
  'bar-chart-3': BarChart3,
  'line-chart': LineChart,
  'pie-chart': PieChart,
  'layout-dashboard': LayoutDashboard,
  dashboard: LayoutDashboard,
  table: Table,
  list: List,
  database: Database,
  box: Box,
  terminal: Terminal,
  bell: Bell,
  zap: Zap,
}

export function resolveViewIcon(name?: string): LucideIcon {
  return (name ? VIEW_ICONS[name.toLowerCase()] : undefined) ?? Puzzle
}
