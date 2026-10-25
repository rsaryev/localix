import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { renderFrontmatterFile } from '../agent-core/frontmatter-yaml'
import type { AgentRecordInput } from './contracts'

/** What a Definition holds: the fields of an agent file Localix edits, as authored. */
export type AgentDefinitionInput = Pick<
  AgentRecordInput,
  | 'handle'
  | 'description'
  | 'instructions'
  | 'leadershipPriority'
  | 'modelPreference'
  | 'limits'
  | 'context'
>

/** The efforts Claude Code's own `effort` key accepts; any other word rides under `localix:`. */
const CC_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max'])

/**
 * The frontmatter a Definition sets. A route Claude Code cannot run (`provider/model`) is kept
 * under the `localix:` key with `model: inherit`, so the file stays valid in Claude Code. Fields
 * the Definition does not model (tools, hooks, comments) are left as the file has them.
 */
function frontmatterOf(input: AgentDefinitionInput): Record<string, unknown> {
  const { provider, model, effort } = input.modelPreference ?? {}
  const route = provider && model && !model.includes('/') ? `${provider}/${model}` : model
  const foreign = route?.includes('/') === true
  const ccEffort = effort && CC_EFFORTS.has(effort)
  const localix = {
    ...(input.leadershipPriority ? { priority: input.leadershipPriority } : {}),
    ...(foreign ? { model: route } : {}),
    ...(effort && !ccEffort ? { effort } : {}),
    ...(input.context?.memory ? { memoryScope: input.context.memory.scope } : {}),
  }
  return {
    name: input.handle,
    description: input.description,
    model: foreign ? 'inherit' : route,
    effort: ccEffort ? effort : undefined,
    maxTurns: input.limits?.maxTurns,
    skills: input.context?.preloadSkills?.length ? input.context.preloadSkills : undefined,
    localix: Object.keys(localix).length > 0 ? localix : undefined,
  }
}

/** The agent file for a Definition, over `existing` (empty for a new file): its other keys stay. */
export const agentFileText = (existing: string, input: AgentDefinitionInput): string =>
  renderFrontmatterFile(existing, frontmatterOf(input), input.instructions)

export const agentFilePath = (agentsDir: string, handle: string): string =>
  join(agentsDir, `${handle}.md`)

export const readAgentFileText = (path: string): Promise<string> =>
  readFile(path, 'utf8').catch(() => '')

/** Publish through a staged file and a rename, so a watcher never reads half a file. */
export async function writeAgentFile(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const staged = join(dirname(path), `.${crypto.randomUUID()}.staged`)
  try {
    await writeFile(staged, text, { encoding: 'utf8', flag: 'wx' })
    await rename(staged, path)
  } finally {
    await rm(staged, { force: true })
  }
}
