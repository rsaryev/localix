// Re-export of the SHARED composer `@`-token detector (`@localixai/api/context-refs`) —
// one grammar for every composer, with menu modes derived
// from the ref-kind registry's `picker` field. Kept as a local module so the existing
// import sites (and their tests) stay put.
export {
  detectToken,
  looksLikeMentionPartial,
  type TokenMatch,
  type AtTokenMode,
} from '@localixai/api/context-refs'
