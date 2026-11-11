import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  contentGate,
  workspaceTrustKey,
  workspaceTrustSituation,
  type RepositoryContent,
  type TrustSituation,
  type TrustSource,
} from '@rsaryev/llx-plugin/loading'
import { isRecord } from '../../../../lib/record'
import { claudeStateFile } from '../../../cc-settings/config-dir'
import { folderRepository, type FolderRepository } from './repository'

/**
 * Whether Claude Code trusts a folder, and so what of its repository content takes effect. Localix
 * keeps no trust of its own: it reads Claude Code's state file (`~/.claude.json`, or inside
 * `CLAUDE_CONFIG_DIR`) at each question, so a dialog accepted in Claude Code counts here at once.
 * The kit names the key and the column (`workspaceTrustKey`, `workspaceTrustSituation`: the dialog
 * accepted for the key is `trusted`; outside a repository, accepted for a folder above it,
 * `parent-trusted`) and each kind of content's gate in that column (`contentGate`). Localix shows no
 * trust dialog and runs nothing as `claude -p`, so a folder is never in the `-p` column.
 */

/** Whether the state file records the trust dialog accepted for exactly this key; a missing or unreadable file trusts nothing. */
export function trustedFolders(
  homeDir: string,
  env?: Record<string, string | undefined>,
): (key: string) => boolean {
  let projects: unknown
  try {
    const text = readFileSync(claudeStateFile(homeDir, env), 'utf8')
    projects = (JSON.parse(text) as { projects?: unknown }).projects
  } catch {
    return () => false
  }
  return (key) => {
    const entry = isRecord(projects) && Object.hasOwn(projects, key) ? projects[key] : undefined
    return isRecord(entry) && entry.hasTrustDialogAccepted === true
  }
}

export interface FolderTrustFacts {
  homeDir: string
  cwd: string
  env?: Record<string, string | undefined>
  repository: FolderRepository | undefined
}

/** The folder's column of the trust table and the key its trust is stored under. */
export interface FolderTrust {
  readonly situation: TrustSituation
  readonly key: string
}

/** The folders above `dir`, nearest first. */
function ancestorsOf(dir: string): string[] {
  const out: string[] = []
  for (let at = dirname(dir); at !== (out.at(-1) ?? dir); at = dirname(at)) out.push(at)
  return out
}

export function folderTrustOf(facts: FolderTrustFacts): FolderTrust {
  const startDir = resolve(facts.cwd)
  const trustFacts = {
    startDir,
    homeDir: facts.homeDir,
    ...(facts.repository ? { mainCheckoutRoot: facts.repository.root } : {}),
    ancestors: ancestorsOf(startDir),
  }
  const situation = workspaceTrustSituation(trustedFolders(facts.homeDir, facts.env), trustFacts)
  return { situation, key: workspaceTrustKey(trustFacts).key }
}

/** Claude Code's trust of a folder, its repository read from the disk. */
export const folderTrust = (input: Omit<FolderTrustFacts, 'repository'>): FolderTrust =>
  folderTrustOf({ ...input, repository: folderRepository(input.cwd) })

/** Whether `content` of the repository takes effect in `situation` (the trust table's row). */
export const contentApplies = (content: RepositoryContent, situation: TrustSituation): boolean =>
  contentGate(content, situation).applies

/** Whether a folder's `.mcp.json` approvals stored for it count (the `mcp-json-servers` row). */
export const repositoryApprovalsCount = (situation: TrustSituation): boolean =>
  contentGate('mcp-json-servers', situation).repositoryApprovals === true

/**
 * Whether Claude Code counts the folder as trusted for its settings files' hooks (the folder's own
 * trust or a parent's): what a person sees as "trusted" next to a folder.
 */
export const claudeCodeTrusts = (input: Omit<FolderTrustFacts, 'repository'>): boolean =>
  contentApplies('settings-hooks', folderTrust(input).situation)

/** Claude Code's column of the trust table for a folder: what of its repository content takes effect. */
export const claudeCodeTrust = (input: Omit<FolderTrustFacts, 'repository'>): TrustSituation =>
  folderTrust(input).situation

/** How the folder came to be trusted, in the words a server's `headersHelper` gate reads (`planHeadersHelper`). */
const TRUST_SOURCE: { readonly [S in TrustSituation]: TrustSource } = {
  trusted: 'persisted',
  'parent-trusted': 'parent-folder',
  'non-interactive': 'automatic-session',
  dialog: 'none',
}

export const trustSourceOf = (situation: TrustSituation): TrustSource => TRUST_SOURCE[situation]

const SOURCES: ReadonlySet<unknown> = new Set(Object.values(TRUST_SOURCE))

/**
 * The trust stamped on a server's record (`mcp-plan.ts`), or none: a record with no stamp, or one of
 * another shape, runs no helper that needs the folder's trust.
 */
export function stampedTrust(value: unknown, cwd: string): { source: TrustSource; key: string } {
  const stamp = isRecord(value) ? value : {}
  return SOURCES.has(stamp.source) && typeof stamp.key === 'string'
    ? { source: stamp.source as TrustSource, key: stamp.key } // narrowed by SOURCES
    : { source: 'none', key: cwd }
}
