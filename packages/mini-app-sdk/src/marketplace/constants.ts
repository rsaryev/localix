import { MINI_APP_MANIFEST_DIR } from '../manifest/app'

/**
 * Where a mini app marketplace lives and what it is called
 * (`docs/extending/mini-app-marketplace.md`).
 */

/** The format's version: it only grows, and a number is never used twice. */
export const MARKETPLACE_SCHEMA = 3
/** The marketplace a repository keeps, beside the manifest folder's name a mini app uses. */
export const MARKETPLACE_FILE = `${MINI_APP_MANIFEST_DIR}/marketplace.json`
/** The built marketplace a release publishes, with its archives and media beside it. */
export const MARKETPLACE_RELEASE_FILE = 'mini-app-marketplace.json'
/** The file of signatures beside a released marketplace: `<file>.sig`. */
export const MARKETPLACE_SIGNATURE_SUFFIX = '.sig'
/** A marketplace's name: lower-case words joined by dashes, 2 to 64 characters. */
export const MARKETPLACE_NAME_RE = /^[a-z0-9][a-z0-9-]{1,63}$/
/** A GitHub repository, `owner/name`. */
export const GITHUB_REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/
export const SHA256_RE = /^[a-f0-9]{64}$/
/** An Ed25519 public key, 32 bytes in base64: 43 characters and one `=`. */
export const ED25519_KEY_RE = /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/

/** The marketplace a GitHub repository's latest release publishes. */
export const githubMarketplaceUrl = (repo: string): string =>
  `https://github.com/${repo}/releases/latest/download/${MARKETPLACE_RELEASE_FILE}`

/** An app's identity across marketplaces: `<app>@<marketplace>`. */
export const marketplaceAppId = (app: string, marketplace: string): string =>
  `${app}@${marketplace}`
