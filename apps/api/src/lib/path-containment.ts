/**
 * PATH CONTAINMENT for `apps/api` — RE-EXPORTED from the owner, `@localixai/path-containment`.
 *
 * The rule used to live here, but that made it unreachable: `packages/agent` and `apps/ui`
 * may not depend on `apps/api`, so they could not import it and each grew a hand-rolled
 * copy instead. The rule now lives in a zero-dep base-layer package every tree
 * can import; this module stays only so the ~30 `apps/api` call sites keep importing it by
 * the path they already use.
 *
 * See the package for the full contract, the three traps, and the `ContainedPath` brand.
 */
export {
  isPathWithin,
  isPathBelow,
  resolveWithin,
  isAtOrUnder,
  isStrictlyUnder,
  type ContainedPath,
} from '@localixai/path-containment'
