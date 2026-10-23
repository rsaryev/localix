/**
 * The kit catalog: one entry per module a surface may import to draw itself, with the job it is
 * for and what it must not be confused with.
 *
 * It exists because a props list does not tell anyone WHICH primitive a job needs. The mini app
 * authoring agent was given sixteen prop signatures and nothing else, so it hand-rolled tabs, a
 * checkbox, a tree row and a progress bar that the kit already had; a person reading `entries/`
 * sees 84 file names. The catalog is the answer to "I need X — which module?", read by the kit's
 * docs, the mini app kit staging (`scripts/stage-mini-app-kit.mjs` writes it into `kit.json`) and
 * the `/mini-app create` instruction. Its tests pin it to the doors in both directions, so a new
 * door without an entry, or an entry without a door, fails.
 */

export type KitCategory =
  | 'controls'
  | 'overlays'
  | 'layout'
  | 'lists'
  | 'feedback'
  | 'content'
  | 'canvas'
  | 'keyboard'
  | 'recipes'
  | 'foundation'

/**
 * Who serves the module. `kit`: a door of this package (`src/entries/<id>.ts`). `host`: a module
 * the app lends under the same namespace because it is bound to a host feature
 * (`apps/ui/src/app/kit/<id>.ts`). `sdk`: a UI module of `@localixai/mini-app-sdk` that belongs in
 * the same choice — the segmented control, the charts, the class recipes.
 */
export type KitProvider = 'kit' | 'host' | 'sdk'

export interface KitCatalogEntry {
  /** The import specifier, exactly as a surface writes it. */
  specifier: string
  category: KitCategory
  provider: KitProvider
  /** The main exports, the ones a caller reaches for first. */
  exports: readonly string[]
  /** What it is, in one line. */
  summary: string
  /** The job it is for: reach for it when… */
  use: string
  /** What it replaces, or which module to take instead for a neighbouring job. */
  not?: string
}
