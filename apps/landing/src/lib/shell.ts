/**
 * The one page shell every landing surface centres on.
 *
 * Home sections, the docs page, and the site footer all sit on the same
 * column, so their left/right edges line up when you scroll from a section
 * into the footer. Hand-rolling a second `mx-auto max-w-… px-…` (docs used to
 * carry `max-w-[88rem] px-5`) put the footer edges a few pixels off the
 * content on `/docs`.
 *
 * Import this **relatively**, not through the `@/` alias. Vite resolves `@/`,
 * but `bun test` runs from the repository root and reads the root tsconfig, so
 * an aliased import breaks every DOM test that module-loads the importer.
 */
export const PAGE_SHELL = 'mx-auto w-full max-w-[90rem] px-6 lg:px-10'

/**
 * The homepage's wider column. The home is one screen, so it scales with the window instead of
 * stopping at the docs' reading measure: the header, the hero and the footer share it so their
 * edges line up at every width. Its geometry lives in `styles/hero.css`.
 */
export const HOME_SHELL = 'home-shell'
