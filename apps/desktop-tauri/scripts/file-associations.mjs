// Single owner of ONE fact: which file types the operating system should believe
// Localix can open.
//
// Core's code editor and image viewer know, at runtime, what the app can render. None of
// that reaches the OS. Finder, Explorer and the freedesktop MIME database are told what an
// app opens exactly once — when the app is PACKAGED — through the bundle's Info.plist, the
// installer's registry writes and the `.desktop` file. Tauri sources all three from
// `bundle.fileAssociations` in tauri.conf.json, which is a static, committed file that no
// runtime registry can amend.
//
// So the projection happens here: core keeps its list in CORE_FILE_ASSOCIATIONS below, and
// this module emits exactly the array tauri.conf.json must contain. Core claims only what
// core itself renders; it does not know what an extension installed later can open.
// `--write` applies it; `--check` (and the sibling test) fails when the committed config and
// the list disagree.
//
// Plain `.mjs` on purpose: it runs from packaging scripts and gates under bare node,
// with no TypeScript loader available.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url)) // apps/desktop-tauri/scripts
export const repoRoot = resolve(here, '..', '..', '..')
export const tauriConfigPath = resolve(here, '..', 'src-tauri', 'tauri.conf.json')

/**
 * CORE's claim: the families the built-in viewers open — text/source in the code
 * editor, and raster images in the file viewer's image pane. The formats core does NOT
 * render itself (PDF, Office, databases) are deliberately absent.
 *
 * ONE ENTRY PER MIME TYPE, not per viewer. Tauri writes a single `MimeType=` per entry
 * into the Linux `.desktop` file, so a grouped entry advertises only its first format
 * and the rest silently fail to route there — while looking correct on macOS, which
 * matches on CFBundleTypeExtensions. The text entry is the one legitimate group: every
 * extension in it really is `text/plain`.
 *
 * `rank` on the text entry is left at Tauri's default (`Default`), which suits a
 * source-file list: a first-class opener LaunchServices
 * may offer, not an `Owner` asserting it created the format. Images are `Alternate` and
 * `Viewer`: Preview and Photos own those types, and core shows them read-only — Localix
 * belongs in the Open With list, not ahead of them.
 *
 * `contentTypes` are macOS uniform type identifiers and become `LSItemContentTypes`.
 * They are not a nicety next to `ext`: modern LaunchServices matches a document to an
 * app by its UTI, and the extension list is the legacy fallback. Without a UTI, an app
 * is absent from "Open With" for a file whose type the system knows but whose extension
 * is missing or unusual (an extensionless `Makefile`, a `public.source-code` dialect we
 * never listed), and it cannot be a default handler for a type another app exported.
 * Only system UTIs are declared here — core invents no formats of its own, so there is
 * no `exportedType`. Windows and Linux ignore the field entirely.
 */
export const CORE_FILE_ASSOCIATIONS = [
  {
    ext: [
      'txt',
      'md',
      'markdown',
      'mdx',
      'log',
      'tsv',
      'js',
      'jsx',
      'mjs',
      'cjs',
      'ts',
      'tsx',
      'json',
      'jsonc',
      'html',
      'htm',
      'css',
      'scss',
      'sass',
      'less',
      'vue',
      'svelte',
      'astro',
      'xml',
      'svg',
      'py',
      'rb',
      'go',
      'rs',
      'java',
      'kt',
      'kts',
      'c',
      'h',
      'cpp',
      'cc',
      'hpp',
      'cs',
      'php',
      'swift',
      'scala',
      'lua',
      'dart',
      'r',
      'pl',
      'sh',
      'bash',
      'zsh',
      'fish',
      'ps1',
      'bat',
      'cmd',
      'yaml',
      'yml',
      'toml',
      'ini',
      'cfg',
      'conf',
      'env',
      'properties',
      'gradle',
      'graphql',
      'gql',
      'proto',
      'dockerfile',
      'makefile',
      'gitignore',
      'editorconfig',
    ],
    contentTypes: ['public.plain-text', 'public.source-code'],
    name: 'Localix Source File',
    description: 'Text or source code file',
    mimeType: 'text/plain',
    role: 'Editor',
  },
  // Raster images the core file viewer decodes and displays (`BINARY_IMAGE_MIME` in
  // `apps/api/.../chat/service/files.ts`, rendered by FileTab's image pane). `.svg` is
  // NOT here: it is XML the code editor edits, and it is already claimed above.
  {
    ext: ['png'],
    contentTypes: ['public.png'],
    name: 'PNG Image',
    description: 'Portable Network Graphics image',
    mimeType: 'image/png',
    role: 'Viewer',
    rank: 'Alternate',
  },
  {
    ext: ['jpg', 'jpeg'],
    contentTypes: ['public.jpeg'],
    name: 'JPEG Image',
    description: 'JPEG image',
    mimeType: 'image/jpeg',
    role: 'Viewer',
    rank: 'Alternate',
  },
  {
    ext: ['gif'],
    contentTypes: ['com.compuserve.gif'],
    name: 'GIF Image',
    description: 'Graphics Interchange Format image',
    mimeType: 'image/gif',
    role: 'Viewer',
    rank: 'Alternate',
  },
  {
    ext: ['webp'],
    contentTypes: ['org.webmproject.webp'],
    name: 'WebP Image',
    description: 'WebP image',
    mimeType: 'image/webp',
    role: 'Viewer',
    rank: 'Alternate',
  },
  {
    ext: ['avif'],
    contentTypes: ['public.avif'],
    name: 'AVIF Image',
    description: 'AV1 Image File Format image',
    mimeType: 'image/avif',
    role: 'Viewer',
    rank: 'Alternate',
  },
  {
    ext: ['bmp'],
    contentTypes: ['com.microsoft.bmp'],
    name: 'Bitmap Image',
    description: 'Windows bitmap image',
    mimeType: 'image/bmp',
    role: 'Viewer',
    rank: 'Alternate',
  },
  {
    ext: ['ico'],
    contentTypes: ['com.microsoft.ico'],
    name: 'Icon Image',
    description: 'Windows icon image',
    mimeType: 'image/x-icon',
    role: 'Viewer',
    rank: 'Alternate',
  },
]

/** Extension spelling the OS registries get: dot-less, lower-case. Mirrors Tauri's parser. */
export function normalizeExt(ext) {
  const trimmed = String(ext).trim().toLowerCase()
  return trimmed.startsWith('.') ? trimmed.slice(1) : trimmed
}

const EXT_RE = /^[a-z0-9][a-z0-9+._-]*$/
// A uniform type identifier is reverse-DNS ("public.png", "com.microsoft.bmp"). Rejecting
// anything else keeps a bare MIME type or a file extension out of `LSItemContentTypes`,
// where LaunchServices would simply never match it and the association would go quiet.
const UTI_RE = /^[a-z0-9]+(\.[a-z0-9][a-z0-9-]*)+$/i
const ROLES = new Set(['Editor', 'Viewer', 'Shell', 'None'])
const RANKS = new Set(['Owner', 'Default', 'Alternate', 'None'])

/**
 * One normalized `bundle.fileAssociations` entry, in the exact shape Tauri parses.
 * @typedef {{ ext: string[], contentTypes?: string[], name: string, description?: string, mimeType?: string, role?: string, rank?: string }} FileAssociationEntry
 */

/**
 * Validate + normalize one authored entry. Throws with the owner's name in the message:
 * this runs inside packaging, where "invalid file association" with no origin would not
 * say which entry is wrong.
 * @returns {FileAssociationEntry}
 */
function normalizeAssociation(entry, owner) {
  const fail = (why) => {
    throw new Error(`${owner}: invalid fileAssociations entry — ${why}`)
  }
  if (!entry || typeof entry !== 'object') fail('not an object')
  if (!Array.isArray(entry.ext) || entry.ext.length === 0) fail('`ext` must be a non-empty array')
  const ext = entry.ext.map(normalizeExt)
  for (const value of ext) {
    if (!EXT_RE.test(value)) fail(`extension "${value}" is not a bare alphanumeric extension`)
  }
  if (entry.contentTypes !== undefined) {
    if (!Array.isArray(entry.contentTypes) || entry.contentTypes.length === 0) {
      fail('`contentTypes` must be a non-empty array of UTIs when present')
    }
    for (const uti of entry.contentTypes) {
      if (typeof uti !== 'string' || !UTI_RE.test(uti)) {
        fail(`content type "${uti}" is not a reverse-DNS uniform type identifier`)
      }
    }
  }
  if (typeof entry.name !== 'string' || entry.name.trim() === '') fail('`name` is required')
  if (entry.role !== undefined && !ROLES.has(entry.role)) fail(`unknown role "${entry.role}"`)
  if (entry.rank !== undefined && !RANKS.has(entry.rank)) fail(`unknown rank "${entry.rank}"`)
  // Key order is fixed so the generated JSON is byte-stable across runs and readable
  // in a diff; optional keys stay absent rather than becoming explicit nulls, which
  // Tauri's `Option<String>` would accept but no author would have written.
  const out = { ext }
  if (entry.contentTypes !== undefined) out.contentTypes = [...entry.contentTypes]
  out.name = entry.name
  if (entry.description !== undefined) out.description = entry.description
  if (entry.mimeType !== undefined) out.mimeType = entry.mimeType
  if (entry.role !== undefined) out.role = entry.role
  if (entry.rank !== undefined) out.rank = entry.rank
  return out
}

/**
 * The complete `bundle.fileAssociations` array, from core's list.
 *
 * An extension may appear only ONCE in the emitted bundle. Two entries claiming `.csv`
 * would put two CFBundleDocumentTypes dicts in the same Info.plist and two conflicting
 * registry writes in the same installer — LaunchServices would then pick one by rules
 * nobody intended. A duplicate claim throws, naming the extension.
 */
export function buildFileAssociations() {
  const claimed = new Set()
  return CORE_FILE_ASSOCIATIONS.map((association) => normalizeAssociation(association, 'core')).map(
    (association) => {
      for (const ext of association.ext) {
        if (claimed.has(ext)) {
          throw new Error(`file association conflict: ".${ext}" is claimed by more than one entry.`)
        }
        claimed.add(ext)
      }
      return association
    },
  )
}

/** The committed tauri.conf.json, parsed. */
export function readTauriConfig() {
  return JSON.parse(readFileSync(tauriConfigPath, 'utf8'))
}

/**
 * Rewrite `bundle.fileAssociations` in place. Serializing the parsed config normalizes
 * the WHOLE file's whitespace (every inline array explodes), so the repo formatter runs
 * straight after — otherwise a one-entry change would land as a 100-line reformat and
 * `format:check` would go red. `checkFileAssociations` compares parsed values, so a
 * missing formatter degrades the diff, never the correctness of the gate.
 * @returns {{ changed: boolean }}
 */
export function writeFileAssociations() {
  const config = readTauriConfig()
  const next = buildFileAssociations()
  const before = JSON.stringify(config.bundle?.fileAssociations ?? null)
  if (before === JSON.stringify(next)) return { changed: false }
  config.bundle.fileAssociations = next
  writeFileSync(tauriConfigPath, `${JSON.stringify(config, null, 2)}\n`)
  formatTauriConfig()
  return { changed: true }
}

/** Re-apply the repo's oxfmt formatting to the config. No-op when oxfmt isn't installed. */
function formatTauriConfig() {
  const oxfmt = join(repoRoot, 'node_modules', '.bin', 'oxfmt')
  if (!existsSync(oxfmt)) return
  execFileSync(oxfmt, ['--write', tauriConfigPath], { stdio: 'ignore' })
}

/**
 * Is the committed config in sync with what core declares?
 * @returns {{ ok: boolean, expected: FileAssociationEntry[], actual: unknown }}
 */
export function checkFileAssociations() {
  const expected = buildFileAssociations()
  const actual = readTauriConfig().bundle?.fileAssociations
  return { ok: JSON.stringify(actual) === JSON.stringify(expected), expected, actual }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const write = process.argv.includes('--write')
  if (write) {
    const { changed } = writeFileAssociations()
    console.log(
      changed
        ? 'tauri.conf.json: bundle.fileAssociations updated'
        : 'tauri.conf.json: bundle.fileAssociations already up to date',
    )
  } else {
    const { ok, expected, actual } = checkFileAssociations()
    if (ok) {
      const exts = expected.reduce((n, e) => n + e.ext.length, 0)
      console.log(`file associations in sync (${expected.length} entries, ${exts} extensions)`)
    } else {
      console.error('tauri.conf.json bundle.fileAssociations is STALE.')
      console.error('Run: bun apps/desktop-tauri/scripts/file-associations.mjs --write')
      console.error(`expected:\n${JSON.stringify(expected, null, 2)}`)
      console.error(`actual:\n${JSON.stringify(actual, null, 2)}`)
      process.exitCode = 1
    }
  }
}
