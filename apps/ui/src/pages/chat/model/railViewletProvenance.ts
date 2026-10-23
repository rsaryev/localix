/** Core and mini app viewlets share one registry; only stamped ownership means mini app. */
export const isMiniAppRailViewlet = (viewlet: { miniAppName?: string }): boolean =>
  Boolean(viewlet.miniAppName)
