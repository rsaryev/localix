import { MINI_APP_MANIFEST_FILE } from '@localixai/mini-app-sdk/app-manifest'
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
 * refuses a version it does not read.
 */
export const tools = {
  version: 1 as const,
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
