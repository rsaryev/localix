import type { Kit, KitTools } from '../kit/kit'

/**
 * A kit for unit tests: the shape `loadKit` returns, with the tools a test does not replace doing
 * nothing. The kit Localix publishes is tested against this toolchain in Localix's repository.
 */
export function fakeKit(overrides: { dir?: string; tools?: Partial<KitTools> } = {}): Kit {
  const tools: KitTools = {
    version: 1,
    manifest: {
      file: 'mini-app.json',
      validate: async () => ({ name: null, errors: [], warnings: [] }),
      checkMedia: async () => [],
      iconTypes: { svg: 'image/svg+xml', png: 'image/png' },
      screenshotTypes: { png: 'image/png' },
    },
    ui: {
      artifactDir: 'dist/ui',
      artifactManifest: 'artifact.json',
      sharedGlobal: '__LOCALIX_MINI_APP_UI_SHARED__',
      preloadedModules: ['react'],
      sharedModule: /^(?:react|@localixai\/kit\/.+)$/u,
    },
    style: {
      rules: [],
      themeTokensOf: () => ({ colors: new Set(), radii: new Set() }),
      missingTokens: () => [],
    },
    routes: {
      rawBodyParse: /\b[A-Za-z_$][\w$]*\.req\s*\.\s*json\s*\(/gu,
      rawBodyParseFix:
        "read the body with jsonBody(schema) from '@localixai/mini-app-sdk/backend' and c.req.valid('json')",
    },
    compileTailwind: async () => ({ build: () => '' }),
    ...overrides.tools,
  }
  const dir = overrides.dir ?? '/kit'
  return {
    dir,
    templateDir: `${dir}/template`,
    tools,
    manifest: {
      apiVersion: 1,
      kitModules: [],
      uiSharedExports: {},
      hostStylesheet: 'ui/styles/index.css',
      backendModules: {},
      uiVendorModules: {},
      typePaths: {},
      authoring: {
        version: 1,
        template: 'template',
        styles: 'ui/styles',
        tailwindUtilities: 'ui/styles/tailwindcss/utilities.css',
        typecheck: 'typescript/check.mjs',
        typeRoots: 'types/node_modules/@types',
        testPreload: 'backend/test-preload.mjs',
        backendSharedModules: ['hono', 'zod', '@localixai/mini-app-sdk/backend'],
        uiPrebuiltModules: ['zod'],
        tools: 'tools/authoring.js',
      },
    },
  }
}
