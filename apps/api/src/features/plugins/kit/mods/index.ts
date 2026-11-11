/**
 * The kit's mods runtime values Localix's mods host (`features/mods`) calls beyond the boundary's
 * own `index.ts`: the settings layers a mod reads (`$.settings`), as the kit decodes and merges
 * them, the render sites a mod's element tables are for, and the drawing of a render site Localix shows on its own screen — the `ui.render` event
 * and its fold, a tree's controls kept apart from its plain data and named by their keys, and a
 * control used on screen routed to its callback; and the scan of a hooks module's file, which names
 * the surface modules its `Client`s draw.
 */
export {
  controlKey,
  defaultElementTable,
  ENGINE_ORIGIN,
  foldRender,
  isElementNode,
  joinHandlers,
  mergeModSettingsLayers,
  plainDataProblem,
  RENDER_SITE_NAMES,
  renderEvent,
  routeControl,
  scanHooksModule,
  settingsLayersForMods,
  splitHandlers,
} from '@rsaryev/llx-plugin/mods'
