import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import type { Kit } from '../kit/kit'
import { writeKitCatalog } from '../kit/kit-files'
import { UserError } from '../lib/errors'
import { ensureGitignore } from '../publish/ci'
import { agentsMd, readme } from './prose'
import {
  fillPlaceholders,
  listFiles,
  loadTemplateScaffold,
  TEMPLATE_SCAFFOLD_FILE,
  type TemplateScaffold,
} from './template-layout'

const MINI_APP_MANIFEST_FILE = 'mini-app.json'

/**
 * Fork the kit's reference mini app into a new mini app at `dir`.
 *
 * Why a fork of a shipped, tested mini app and not a hollow skeleton: a skeleton with placeholders
 * cannot be built or tested itself, so it rots the moment the SDK moves; a copy of the template is
 * a working mini app in the first second, and the agent (or a person) replaces its DOMAIN, never its
 * frame.
 *
 * Why a rename MAP and not a search-and-replace of the template's name: the domain's identifiers
 * (its tools and skill) would collide with the template's when both mini apps are enabled — tool
 * names are global — and the two prose files use the word as a noun. So code files get the identity
 * map, the domain identifiers the template declares in its `scaffold.json` are made unique to the
 * copy, and the prose files are regenerated.
 *
 * The copy is assembled beside its destination and moved into place with one rename, so discovery
 * never sees half a mini app and a failure leaves nothing behind to block the retry.
 */

/** Lower-kebab only: the PascalCase and snake_case derivations below need one clean shape. */
export const MINI_APP_NAME_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u
const MAX_NAME_LENGTH = 40

/**
 * The lower-kebab name nearest to what the model proposed. A creation that failed on `GPU_Monitor`
 * or `gpu monitor` cost a whole model round trip to say "lower-kebab-case" back; the shape is
 * mechanical, so the host applies it. Nothing usable (all punctuation, another script) falls back
 * to a generic name the free-name search then makes unique.
 */
export function toMiniAppName(raw: string): string {
  const slug = raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/gu, '')
    .replace(/([a-z0-9])([A-Z])/gu, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .slice(0, MAX_NAME_LENGTH)
    .replace(/^[^a-z]+|-+$/gu, '')
  return MINI_APP_NAME_RE.test(slug) ? slug : 'my-mini-app'
}
/** The template's own name: every identity token of the template contains it as a word. */
const TEMPLATE_NAME = 'template'
const REWRITE_EXT = /\.(?:[cm]?tsx?|json|html|css|md)$/u

export class ScaffoldError extends UserError {}

export interface ScaffoldInput {
  kit: Kit
  /** The folder the copy becomes; it must not exist yet. */
  dir: string
  name: string
  /** What the person sees; `titleCase(name)` turns `gpu-monitor` into "Gpu Monitor". */
  displayName?: string
  description?: string
}

export interface ScaffoldResult {
  name: string
  displayName: string
  description: string
  dir: string
  scaffold: TemplateScaffold
}

const pascalCase = (name: string) =>
  name
    .split('-')
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('')
export const titleCase = (name: string) =>
  name
    .split('-')
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(' ')

/**
 * Ordered rewrites for one copy. Identity first — every identity token of the template (its route,
 * work-item namespace and resource namespace) CONTAINS the template's name as a word, so one
 * word-bounded pass covers them all — then the PascalCase identifiers, then the domain identifiers
 * the template declares, which must not collide.
 */
export function renameMap(
  name: string,
  displayName: string,
  scaffold: TemplateScaffold,
): [RegExp, string][] {
  return [
    [new RegExp(`\\b${TEMPLATE_NAME}\\b`, 'gu'), name],
    [new RegExp(pascalCase(TEMPLATE_NAME), 'gu'), pascalCase(name)],
    ...scaffold.renames.map(({ pattern, replacement }): [RegExp, string] => [
      new RegExp(pattern, 'gu'),
      fillPlaceholders(replacement, { name, displayName }),
    ]),
  ]
}

/**
 * The display name is written INTO source by the rename map ("Daily Log" sits in string
 * literals, JSX text and JSON), so a quote, backtick, brace or angle bracket in it would break the
 * copy's code before the agent touched it. Keep it to one plain line.
 */
function cleanDisplayName(raw: string | undefined): string {
  return (raw ?? '')
    .replace(/["'`\\${}<>]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, MAX_NAME_LENGTH)
}

async function exists(path: string): Promise<boolean> {
  // lstat also sees dangling symlinks, which rename would otherwise replace silently.
  return fs.lstat(path).then(
    () => true,
    () => false,
  )
}

function validate({ name }: ScaffoldInput): void {
  // The name becomes a directory, a package namespace and part of every tool name, so the shape
  // check is also what keeps it from naming a path.
  if (!MINI_APP_NAME_RE.test(name)) {
    throw new ScaffoldError(
      `Mini app name "${name}" must be lower-kebab-case: letters, digits and dashes.`,
    )
  }
  if (name === TEMPLATE_NAME) {
    throw new ScaffoldError(`"${name}" is the reference mini app's own name — choose another.`)
  }
}

async function rewriteCopy(dir: string, map: [RegExp, string][]): Promise<void> {
  for (const file of listFiles(dir)) {
    if (!REWRITE_EXT.test(file)) continue
    const path = join(dir, file)
    const before = await fs.readFile(path, 'utf8')
    const after = map.reduce((text, [pattern, value]) => text.replace(pattern, value), before)
    if (after !== before) await fs.writeFile(path, after)
  }
}

/** Patch the copy's `mini-app.json`. */
async function patchManifest(
  dir: string,
  file: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const path = join(dir, file)
  const manifest = JSON.parse(await fs.readFile(path, 'utf8')) as Record<string, unknown>
  await fs.writeFile(path, `${JSON.stringify({ ...manifest, ...patch }, null, 2)}\n`)
}

export async function scaffoldMiniApp(input: ScaffoldInput): Promise<ScaffoldResult> {
  // Validate → decide → write.
  validate(input)
  const { kit, dir, name } = input
  const parent = dirname(dir)
  if (await exists(dir)) {
    throw new ScaffoldError(`${dir} already exists — choose another name, or remove that folder.`)
  }
  const scaffold = loadTemplateScaffold(kit.templateDir)
  const displayName = cleanDisplayName(input.displayName) || titleCase(name)
  const description = input.description?.trim() || `${displayName} workbench.`

  // Assembled beside the destination, on the same filesystem, so the final move is one rename.
  const staging = join(parent, `.scaffold-${name}-${randomUUID()}`)
  await fs.mkdir(parent, { recursive: true })
  try {
    await fs.cp(kit.templateDir, staging, {
      recursive: true,
      filter: (src) => basename(src) !== TEMPLATE_SCAFFOLD_FILE,
    })
    await rewriteCopy(staging, renameMap(name, displayName, scaffold))
    for (const { from, to } of scaffold.directoryRenames) {
      const source = join(staging, from)
      if (await exists(source))
        await fs.rename(source, join(staging, fillPlaceholders(to, { name })))
    }
    // The copy's identity. Its `backend` stays the template's source entry; a build points the
    // package's copy of the manifest at the bundle.
    await patchManifest(staging, MINI_APP_MANIFEST_FILE, {
      name,
      displayName,
      description,
      version: '0.1.0',
      // The template's author is Localix's, not the copy's: its own is set when it is published.
      author: undefined,
    })
    await fs.writeFile(
      join(staging, 'README.md'),
      readme({ name, displayName, description, scaffold }),
    )
    await fs.writeFile(join(staging, 'AGENTS.md'), agentsMd({ name, displayName, kit, scaffold }))
    await writeKitCatalog(kit, staging)
    // Ready for git from the start: what the checks generate never reaches a repository.
    await ensureGitignore(staging)
    if (await exists(dir)) {
      throw new ScaffoldError(`${dir} already exists — choose another name, or remove that folder.`)
    }
    await fs.rename(staging, dir)
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true })
    throw error
  }
  return { name, displayName, description, dir, scaffold }
}
