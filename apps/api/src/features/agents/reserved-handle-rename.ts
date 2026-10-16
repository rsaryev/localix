import { rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { HUMAN_HANDLE } from '@localixai/agent/agents'

/**
 * `human` became the person's built-in record after agents could already be saved under that
 * handle — as `human.json`, the very file the person's own override is written to. Such an agent
 * is moved once to `human-agent.json` under the handle `human-agent`, with a log line, so it keeps
 * working and a later save of the Human card cannot overwrite it.
 */
export const RENAMED_HUMAN_AGENT_HANDLE = 'human-agent'

interface AgentFileText {
  path: string
  text: string
}

export async function relocateReservedHandle(
  file: AgentFileText,
  warn: (message: string) => void = console.warn,
): Promise<AgentFileText> {
  let value: unknown
  try {
    value = JSON.parse(file.text)
  } catch {
    return file
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return file
  const record = value as { handle?: unknown; kind?: unknown }
  if (typeof record.handle !== 'string' || record.handle.toLowerCase() !== HUMAN_HANDLE) return file
  if (record.kind === 'human') return file
  const text = `${JSON.stringify({ ...record, handle: RENAMED_HUMAN_AGENT_HANDLE }, null, 2)}\n`
  const target = join(dirname(file.path), `${RENAMED_HUMAN_AGENT_HANDLE}.json`)
  try {
    await writeFile(target, text, { encoding: 'utf8', flag: 'wx' })
    await rm(file.path, { force: true })
  } catch {
    // The target name is taken: load the renamed record from where it is, and move nothing.
    warn(
      `[agents] ${file.path}: handle "human" is reserved; loaded as "${RENAMED_HUMAN_AGENT_HANDLE}"`,
    )
    return { path: file.path, text }
  }
  warn(
    `[agents] ${file.path}: handle "human" is reserved for the person; moved to ${target} as "${RENAMED_HUMAN_AGENT_HANDLE}"`,
  )
  return { path: target, text }
}
