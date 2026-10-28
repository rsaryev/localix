import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** The template's own description of its layout (entry, domain, renames). */
export const TEMPLATE_SCAFFOLD_FILE = 'scaffold.json'
const MINI_APP_MANIFEST_FILE = 'mini-app.json'

/**
 * What a copy of the reference mini app is made of, and what a finished copy must no longer contain.
 *
 * One reader for the layout, because three consumers need the same answer and drifted when each
 * had its own: the instruction to the agent (which files to replace), the copy's AGENTS.md, and the
 * check (did the replacement actually happen). One generated mini app passed every gate while still exporting
 * the template's identifiers, its guide still describing the template's tools, and carrying no
 * test at all — the instruction said "rename", nothing checked it. The same session hit the reverse
 * failure too: a "keep as is" file imported a domain module, so deleting the domain broke it.
 * Hence three kinds, and a check that pins the boundary between them.
 *
 * The layout itself is the TEMPLATE's (the kit template's own `scaffold.json`), so no host file
 * names a mini app identity.
 */
export interface TemplateScaffold {
  /** One line naming the template for the agent. */
  summary: string
  domainName: string
  /** Files the copy keeps by path and export; their bodies are the copy's. */
  entry: string[]
  /** The template's own domain: replaced wholesale. A trailing `/` is a directory. */
  domain: string[]
  /**
   * Where the domain SHOWS a pattern a new mini app will need (an acting tool, a route that changes
   * state, a form driven by `send`), each at an `anchor` the file contains. The agent reads the
   * ones its mini app needs before replacing the domain: told only to delete it, one agent wrote its
   * first acting tool from nothing and got the signature wrong twice.
   */
  patterns: { use: string; file: string; anchor: string }[]
  /** Only the in-repo template's own development needs these; the kit never ships them. */
  authoringOnly: string[]
  /** Media a copy must redraw: kept byte for byte, every copy would look like the template. */
  replaceMedia?: string[]
  domainNamedPaths: string[]
  /**
   * Identifiers a correct rewrite never keeps, placeholders allowed (`{snake}_log_entry`). Not
   * every tool: one named for its job (`{snake}_summary`) may rightly stay.
   */
  domainTokens: string[]
  renames: { pattern: string; replacement: string }[]
  directoryRenames: { from: string; to: string }[]
  tools: string[]
}

const SKIP_DIRS = new Set(['node_modules', 'dist', '.turbo', '.git'])
const CODE_EXT = /\.(?:[cm]?tsx?)$/u
const TEST_FILE = /\.test\.tsx?$/u

export function loadTemplateScaffold(templateDir: string): TemplateScaffold {
  return JSON.parse(readFileSync(join(templateDir, TEMPLATE_SCAFFOLD_FILE), 'utf8'))
}

/** Fill `{name}`, `{snake}` and `{displayName}` for one copy. */
export function fillPlaceholders(
  text: string,
  { name, displayName = name }: { name: string; displayName?: string },
): string {
  return text
    .replaceAll('{name}', name)
    .replaceAll('{snake}', name.replaceAll('-', '_'))
    .replaceAll('{displayName}', displayName)
}

/** The domain as a copy names it: directories renamed after the copy's identity. */
export function copyDomain(scaffold: TemplateScaffold, name: string): string[] {
  return scaffold.domain.map((entry) => {
    const rename = scaffold.directoryRenames.find(({ from }) => entry === `${from}/`)
    return rename ? `${fillPlaceholders(rename.to, { name })}/` : entry
  })
}

/** Mini-app-relative POSIX paths of every file under `dir`, build output excluded. */
export function listFiles(dir: string, base: string = dir, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) listFiles(path, base, out)
    else out.push(relative(base, path).split(sep).join('/'))
  }
  return out.sort((a, b) => a.localeCompare(b))
}

function inList(list: readonly string[], file: string): boolean {
  return list.some((entry) => (entry.endsWith('/') ? file.startsWith(entry) : file === entry))
}

/** Whether a template file reaches a user copy (the kit ships exactly these). */
export function shipsToCopies(scaffold: TemplateScaffold, file: string): boolean {
  return !inList(scaffold.authoringOnly, file)
}

/**
 * What a copy still carries from the template's domain, one line per defect. Every rule keys on a
 * template path or identifier, so a mini app that never was a copy trips none of them — except the
 * last: a mini app with no test at all is reported whatever its origin.
 */
export function findTemplateResidue(
  miniAppDir: string,
  name: string,
  scaffold: TemplateScaffold,
  templateDir: string,
): string[] {
  const files = listFiles(miniAppDir)
  const problems: string[] = []
  const domainNamed = new RegExp(scaffold.domainNamedPaths.join('|'), 'iu')

  for (const entry of scaffold.domain.filter((path) => domainNamed.test(path))) {
    const kept = entry.endsWith('/')
      ? files.some((file) => file.startsWith(entry))
      : files.includes(entry)
    if (kept) {
      problems.push(
        `${entry} keeps its ${scaffold.domainName} name — rename it after what it now holds, or delete it`,
      )
    }
  }

  const identifiers = scaffold.domainTokens.map((token) => fillPlaceholders(token, { name }))
  const tokens = new RegExp(`\\b(?:${identifiers.join('|')})\\b`, 'u')
  // The guide is the agent's: one that still describes the template's tools misleads it.
  const guideFile = (path: string) => path === 'guide.md' || path.startsWith('guide/')
  for (const file of files.filter((path) => CODE_EXT.test(path) || guideFile(path))) {
    const match = readFileSync(join(miniAppDir, file), 'utf8').match(tokens)
    if (match) problems.push(`${file} still names the template domain (\`${match[0]}\`)`)
  }

  // A hand edit that leaves a trailing comma is the commonest way to break the manifest. Thrown,
  // it surfaced as a bare "JSON Parse error" with no file, and the agent spent a turn finding it.
  // Still thrown: an unreadable manifest is an error, never excusable residue on a fresh copy.
  try {
    JSON.parse(readFileSync(join(miniAppDir, MINI_APP_MANIFEST_FILE), 'utf8'))
  } catch (error) {
    throw new Error(`${MINI_APP_MANIFEST_FILE} is not valid JSON: ${(error as Error).message}`)
  }

  // A copy that keeps the template's icon looks like the template in the Dock, the rail and the
  // store; a missing one is the store media step's to report.
  for (const media of scaffold.replaceMedia ?? []) {
    if (!files.includes(media)) continue
    const original = join(templateDir, media)
    if (
      existsSync(original) &&
      readFileSync(join(miniAppDir, media)).equals(readFileSync(original))
    ) {
      problems.push(
        `${media} is still the ${scaffold.domainName} icon — draw this app's own with mini-app icon --glyph`,
      )
    }
  }

  if (!files.some((file) => TEST_FILE.test(file))) {
    problems.push('no test: test the behaviour of the backend and the shared logic')
  }
  return problems
}
