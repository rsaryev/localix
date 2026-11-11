/**
 * `$.state` as the kit holds it (plugins/mods/interface.md, "Keep a value in `$.state`"): a store
 * whose every write gives the value a new version (`ifVersion` writes only over the one it names),
 * and the helpers `atom`, `read`, `update`, `derive` and `memberOf` as the JavaScript text a bundled
 * module gets behind `import … from 'claude-code'`, so the same helpers run in the API process and
 * in a mod's VM or a surface module's frame. Localix keeps what bounds a space and subscribes a
 * drawing (`features/mods/api/state-api.ts`).
 */
export {
  createStateStore,
  deepFreeze,
  STATE_LIBRARY_SOURCE,
  type StateRef,
  type StateStore,
} from '@rsaryev/llx-plugin/mods'
