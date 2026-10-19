/**
 * The fake API key the isolated runtime's provider connection holds. `provider.mjs` answers only
 * requests that carry it; it is not a credential and reaches no provider.
 */
export const PLACEHOLDER_KEY = 'session-e2e-placeholder-not-a-credential'
