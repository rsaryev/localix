// Public tab primitives. Each one lives in its own module; this file is the
// stable import path the `tabs` door and in-kit callers use.
export { TabStrip } from './tab-strip'
export { TabBar } from './tab-bar'
export { TabPanel, useTabPanelIds, type TabPanelProps } from './tab-panel'
export type { StripTabItem, TabBarProps, TabItem, TabMenuItem, TabStripProps } from './tab-types'
