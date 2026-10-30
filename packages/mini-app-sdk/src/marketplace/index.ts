/**
 * MINI APP MARKETPLACES (`docs/extending/mini-app-marketplace.md`): the format's one definition,
 * read by Localix (`read.ts`) and checked for the people who write one (`validate.ts`), both
 * published to the authoring plugin through the mini app kit's tools. Signatures, which need
 * `node:crypto`, are `@localixai/mini-app-sdk/marketplace-signature`.
 */
export * from './constants'
export * from './read'
export * from './validate'
