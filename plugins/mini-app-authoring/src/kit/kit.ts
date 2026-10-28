import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { UserError } from '../lib/errors'

/**
 * The MINI APP KIT: the platform a Localix release publishes for mini app authors, and the only
 * thing this toolchain takes from Localix. It carries what is Localix's to define and changes with
 * each release: the reference template, the declarations of the SDK and the UI kit, the host
 * theme's stylesheets, the modules the host lends a mini app at runtime, prebuilt copies of them for
 * tests, the TypeScript checker, and `tools` — the SDK's manifest and media rules, the house style,
 * the route body rule and the Tailwind compiler, so a mini app is judged here exactly as Localix
 * judges it. Everything else (scaffold, builds, checks, packing) is this toolchain's.
 *
 * `kit.json` describes it; `authoring.version` is the contract this file reads. A kit without that
 * block was staged for an older Localix, whose app built mini apps itself.
 */

export const KIT_MANIFEST = 'kit.json'
export const KIT_AUTHORING_VERSION = 1

export interface KitAuthoring {
  version: typeof KIT_AUTHORING_VERSION
  /** The reference mini app every scaffold forks, kit-relative. */
  template: string
  /** The kit catalog as Markdown, copied into each mini app as `KIT.md`. */
  catalog?: string
  /** The host theme's stylesheets, imports rewritten to kit-relative paths. */
  styles: string
  /** Tailwind's utilities layer inside {@link styles}: what a mini app's stylesheet emits. */
  tailwindUtilities: string
  /** `bun <typecheck> <miniAppDir>` prints one JSON diagnostic per line. */
  typecheck: string
  /** Where `@types/*` declarations live for the generated `tsconfig.json`. */
  typeRoots: string
  /** `bun test --preload <testPreload>` serves the shared modules to a mini app's tests. */
  testPreload: string
  /** Bare modules a backend may import; the host serves each at runtime. */
  backendSharedModules: string[]
  /** Prebuilt backend modules a UI bundles too (the shared zod contracts). */
  uiPrebuiltModules: string[]
  /** The module {@link KitTools} is read from. */
  tools: string
}

export interface KitManifest {
  /** The host API version this kit's Localix runs mini apps for. */
  apiVersion?: number
  /** The Localix version that staged the kit. */
  localixVersion?: string
  kitModules: string[]
  /** One line per core control — `<id>: <Export> { own props }`. */
  kitDigest?: string[]
  /** Every UI shared specifier → its value export names. */
  uiSharedExports: Record<string, string[]>
  /** The stylesheet a mini app's utilities are compiled against, kit-relative. */
  hostStylesheet: string
  /** Backend and test shared specifiers → the kit-relative prebuilt module. */
  backendModules: Record<string, string>
  /** Vendor packages a UI bundles from the kit → the kit-relative ES module entry. */
  uiVendorModules: Record<string, string>
  /** Every importable specifier → the kit-relative declaration file that types it. */
  typePaths: Record<string, string>
  authoring: KitAuthoring
}

export interface UiTokenRule {
  readonly name: string
  readonly pattern: RegExp
  readonly fix: string
}

export interface ThemeTokens {
  readonly colors: ReadonlySet<string>
  readonly radii: ReadonlySet<string>
}

export interface MissingToken {
  readonly index: number
  readonly match: string
  readonly kind: 'color' | 'radius'
  readonly token: string
  readonly fix: string
}

export interface MiniAppMediaFields {
  icon?: string
  screenshots?: { path: string }[]
  homepage?: string
}

export interface TailwindCompiler {
  build(candidates: string[]): string
}

/** What the kit's `tools` module exports: Localix's own rules, as Localix applies them. */
export interface KitTools {
  version: 1
  manifest: {
    file: string
    /**
     * What Localix's discovery and store say about the mini app folder at `dir` — the SDK's strict
     * schema, the host's own fields, its API version — without loading its code.
     */
    validate(dir: string): Promise<{ name: string | null; errors: string[]; warnings: string[] }>
    checkMedia(
      fields: MiniAppMediaFields,
      read: (path: string) => Promise<Uint8Array | null>,
      options: { requireIcon: boolean },
    ): Promise<string[]>
    /** File extension → media type a catalog serves an icon or a screenshot as. */
    iconTypes: Readonly<Record<string, string>>
    screenshotTypes: Readonly<Record<string, string>>
  }
  ui: {
    artifactDir: string
    artifactManifest: string
    sharedGlobal: string
    preloadedModules: readonly string[]
    sharedModule: RegExp
  }
  style: {
    rules: readonly UiTokenRule[]
    themeTokensOf(...stylesheets: readonly string[]): ThemeTokens
    missingTokens(code: string, tokens: ThemeTokens): MissingToken[]
  }
  routes: { rawBodyParse: RegExp; rawBodyParseFix: string }
  compileTailwind(
    css: string,
    options: {
      base: string
      loadStylesheet: (
        id: string,
        base: string,
      ) => Promise<{ path: string; base: string; content: string }>
      loadModule: (id: string) => Promise<never>
    },
  ): Promise<TailwindCompiler>
}

/** A loaded kit: where it is, what it says about itself, and its tools. */
export interface Kit {
  dir: string
  manifest: KitManifest
  templateDir: string
  tools: KitTools
}

function isKitManifest(value: unknown): value is KitManifest {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  const authoring = record.authoring as Record<string, unknown> | undefined
  return (
    Array.isArray(record.kitModules) &&
    typeof record.hostStylesheet === 'string' &&
    !!record.uiSharedExports &&
    !!record.backendModules &&
    !!record.uiVendorModules &&
    !!record.typePaths &&
    !!authoring &&
    typeof authoring.tools === 'string' &&
    typeof authoring.template === 'string'
  )
}

/** Read the kit at `dir`, or say why it cannot be used. */
export async function loadKit(dir: string): Promise<Kit> {
  let manifest: unknown
  try {
    manifest = JSON.parse(await fs.readFile(join(dir, KIT_MANIFEST), 'utf8'))
  } catch (error) {
    throw new UserError(`No mini app kit at ${dir} (${(error as Error).message}).`)
  }
  if (!isKitManifest(manifest)) {
    throw new UserError(
      `The mini app kit at ${dir} is from a Localix older than this toolchain: update Localix.`,
    )
  }
  if (manifest.authoring.version !== KIT_AUTHORING_VERSION) {
    throw new UserError(
      `The mini app kit at ${dir} speaks authoring version ${String(manifest.authoring.version)}; this toolchain reads ${String(KIT_AUTHORING_VERSION)}. Update the plugin.`,
    )
  }
  const module = (await import(pathToFileURL(join(dir, manifest.authoring.tools)).href)) as {
    tools?: KitTools
  }
  if (module.tools?.version !== 1) {
    throw new UserError(`The mini app kit at ${dir} carries no tools this toolchain can read.`)
  }
  return {
    dir,
    manifest,
    templateDir: join(dir, manifest.authoring.template),
    tools: module.tools,
  }
}
