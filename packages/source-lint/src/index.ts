/**
 * `@localixai/source-lint` — TEST-ONLY. The one way `packages/**` and `plugins/**` read their own
 * source.
 *
 * Some invariants are not observable from a unit test: that a guard runs BEFORE the native call,
 * that a component SUBSCRIBES to a stream, that no wire hand-rolls the string the agent loop
 * classifies on. Those are checked by reading the source and asserting the call is there — which
 * makes the LINT a thing that can be wrong, and every hand-rolled one in this repo was wrong the
 * same three ways: it read comments as code, it walked one directory level, and its own "the lint
 * would catch this" control tested the regex constant instead of the pipeline. All three fail OPEN.
 *
 * Import from here. Do not hand-roll a `readFileSync` in a lint again.
 *
 * `apps/api` has a sibling kit of its own, and that is not a compromise — it is the dependency
 * order. Base packages cannot import `apps/api`, so there are exactly two possible owners,
 * one per side of that boundary. This is the
 * `packages/**` + `plugins/**` one.
 */
export { codeOnly } from './code'
export { auditDetector, type OffenderShape } from './control'
export { type SourceDetector, sourceDetector } from './detector'
export { mustFind, namedBody, offendersIn, readCode, SubjectNotFoundError } from './scan'
export {
  EmptyScanError,
  isSourceFile,
  SKIP_DIRS,
  sourceTree,
  type SourceTreeOptions,
  walkSources,
} from './tree'
