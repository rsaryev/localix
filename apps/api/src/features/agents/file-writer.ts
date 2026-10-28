import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { renderFrontmatterFile } from '../agent-core/frontmatter-yaml'
import type { AgentRecordInput } from './contracts'

/** What a Definition holds: the fields of an agent file Localix edits, as authored. */
export type AgentDefinitionInput = Pick<
  AgentRecordInput,
  'name' | 'description' | 'instructions' | 'maxTurns' | 'skills'
>

/**
 * The frontmatter a Definition sets. The model and effort are not in it: the person chooses them
 * in Localix's settings (`agent-core/agent-model-route.ts`), and the file's own are left as it has
 * them. Fields the Definition does not model (tools, hooks, comments) stay as the file has them.
 */
function frontmatterOf(input: AgentDefinitionInput): Record<string, unknown> {
  return {
    name: input.name,
    description: input.description,
    maxTurns: input.maxTurns,
    skills: input.skills?.length ? input.skills : undefined,
  }
}

/** The agent file for a Definition, over `existing` (empty for a new file): its other keys stay. */
export const agentFileText = (existing: string, input: AgentDefinitionInput): string =>
  renderFrontmatterFile(existing, frontmatterOf(input), input.instructions)

export const agentFilePath = (agentsDir: string, name: string): string =>
  join(agentsDir, `${name}.md`)

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
