import { createContext } from 'react'

/**
 * The site a mod's tree is drawn on: `band`, the strip above the message box, at the composer
 * strips' density; `pane`, a mod's pane tab, at workbench density. Every rule of how a mod is
 * drawn is chosen by the site and the tree's shape, never by which mod drew it.
 */
export type ModSite = 'band' | 'pane'

export const ModSiteContext = createContext<ModSite>('pane')

/** Inside a pane's action bar: a `plain` Button is one of the bar's buttons, not a list row. */
export const ModActionBarContext = createContext(false)

/**
 * Inside a control (a Button's label) or a pane's action bar: text keeps the UI face, whatever the
 * site draws a mod's text in.
 */
export const ModControlContext = createContext(false)
