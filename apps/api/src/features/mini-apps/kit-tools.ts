import { MINI_APP_MANIFEST_FILE } from '@localixai/mini-app-sdk/app-manifest'
import {
  githubMarketplaceUrl,
  MARKETPLACE_FILE,
  MARKETPLACE_RELEASE_FILE,
  MARKETPLACE_SCHEMA,
  MARKETPLACE_SIGNATURE_SUFFIX,
  marketplaceProblems,
  readMarketplace,
} from '@localixai/mini-app-sdk/marketplace'
import {
  publicKeyOf,
  signMarketplace,
  verifyMarketplaceSignature,
} from '@localixai/mini-app-sdk/marketplace-signature'
import {
  checkMiniAppMedia,
  MINI_APP_ICON_TYPES,
  MINI_APP_SCREENSHOT_TYPES,
} from '@localixai/mini-app-sdk/manifest-media'
import {
  MINI_APP_UI_ARTIFACT_DIR,
  MINI_APP_UI_ARTIFACT_MANIFEST,
  MINI_APP_UI_PRELOADED_MODULES,
  MINI_APP_UI_SHARED_GLOBAL,
  MINI_APP_UI_SHARED_MODULE,
} from '@localixai/mini-app-sdk/ui-artifact'
import { compile } from 'tailwindcss'

import { RAW_BODY_PARSE, RAW_BODY_PARSE_FIX } from '../../contracts/route-body-rule'
import { missingTokens, themeTokensOf } from '../../contracts/ui-token-existence'
import { UI_TOKEN_RULES } from '../../contracts/ui-token-rules'
import { loadMiniApp } from './folder'
import { validateMiniApp } from './validate'

/**
 * Localix's own rules for a mini app, as the mini app kit publishes them (`tools/authoring.mjs`,
 * bundled by `scripts/stage-mini-app-kit.mjs`). Making a mini app is not Localix's job: the
 * authoring plugin scaffolds, builds, checks and packs one, and loads this module from
 * the kit so that what it calls valid is exactly what this Localix will run (rule X1: the plugin
 * imports nothing of Localix; it reads a published contract).
 *
 * The shape is versioned (`version`); a change that is not additive raises it, and the plugin
 * refuses a version it does not read. Version 2: the manifest moved into `.localix-mini-app/`,
 * and `marketplace` holds the rules of a mini app marketplace
 * (`docs/extending/mini-app-marketplace.md`), so the plugin builds, checks and signs one exactly
 * as this Localix reads and verifies it.
 */
export const tools = {
  version: 2 as const,
  manifest: {
    file: MINI_APP_MANIFEST_FILE,
    /** What Localix's discovery and the store say about the folder, without loading its code. */
    async validate(
      dir: string,
    ): Promise<{ name: string | null; errors: string[]; warnings: string[] }> {
      const app = await loadMiniApp(dir, 'global', '')
      const { errors, warnings } = validateMiniApp(app)
      return { name: app.manifest?.name ?? null, errors, warnings }
    },
    checkMedia: checkMiniAppMedia,
    iconTypes: MINI_APP_ICON_TYPES,
    screenshotTypes: MINI_APP_SCREENSHOT_TYPES,
  },
  marketplace: {
    /** Where a repository keeps the marketplace its keeper writes. */
    file: MARKETPLACE_FILE,
    /** The released file Localix reads, with its signatures at `<file>.sig`. */
    releaseFile: MARKETPLACE_RELEASE_FILE,
    signatureSuffix: MARKETPLACE_SIGNATURE_SUFFIX,
    schema: MARKETPLACE_SCHEMA,
    /** Every problem with a marketplace as written, each as what to fix; `curation` for Localix's. */
    problems: marketplaceProblems,
    /** A released marketplace as Localix reads it. */
    read: readMarketplace,
    /** The `.sig` of a release's exact bytes, one signature per private key. */
    sign: signMarketplace,
    verify: verifyMarketplaceSignature,
    publicKeyOf,
    /** The release a GitHub repository's marketplace is read from. */
    githubUrl: githubMarketplaceUrl,
  },
  ui: {
    artifactDir: MINI_APP_UI_ARTIFACT_DIR,
    artifactManifest: MINI_APP_UI_ARTIFACT_MANIFEST,
    sharedGlobal: MINI_APP_UI_SHARED_GLOBAL,
    preloadedModules: MINI_APP_UI_PRELOADED_MODULES,
    sharedModule: MINI_APP_UI_SHARED_MODULE,
  },
  style: { rules: UI_TOKEN_RULES, themeTokensOf, missingTokens },
  routes: { rawBodyParse: RAW_BODY_PARSE, rawBodyParseFix: RAW_BODY_PARSE_FIX },
  compileTailwind: compile,
}
