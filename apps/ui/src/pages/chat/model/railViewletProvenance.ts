/** Core and plugin viewlets share one registry; only stamped ownership means plugin. */
export const isPluginRailViewlet = (viewlet: { pluginName?: string }): boolean =>
  Boolean(viewlet.pluginName)
