export type RailArea = 'top' | 'bar' | 'bottom' | 'status' | 'overflow'
export type PinnedRailArea = Exclude<RailArea, 'overflow'>

/** An entry available to the rail, with the area it defaults to when uncustomized. */
export interface RailItemDef {
  id: string
  defaultArea: RailArea
  miniApp?: boolean
  tool?: boolean
  /**
   * `false` for an entry that has no rail placement. It always resolves to
   * `overflow`, even if a saved layout placed it somewhere visible. Defaults to
   * placeable; mini app tools can be pinned and moved like core entries.
   */
  placeable?: boolean
}

/** One entry's placement in the saved layout. */
export interface RailPlacement {
  id: string
  area: RailArea
}

export interface RailLayoutState {
  entries: RailPlacement[]
  /** Restore former mini app overflow defaults and move built-in tools from the lower rail. */
  legacyMiniAppPins?: boolean
}
