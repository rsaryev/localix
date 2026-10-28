import { extname, isAbsolute, join, resolve } from 'node:path'

import type { PersistedMessage } from '../contracts'

export interface ExportPorts {
  title: string
  cwd: string
  /** Where an unnamed export goes. */
  exportsDir: string
  now(): Date
  messages(): Promise<PersistedMessage[]>
  exists(path: string): Promise<boolean>
  write(path: string, text: string): Promise<void>
}

/** What the person read: not a row only the model sees, a notice, or a command's own reply. */
const shown = ({ payload }: PersistedMessage) =>
  !(
    payload.isInternal ||
    payload.uiOnly ||
    payload.promptBlocked ||
    payload.systemNotice ||
    payload.commandOutput ||
    payload.contextBoundary
  ) &&
  (payload.role === 'user' || payload.role === 'assistant') &&
  typeof payload.content === 'string' &&
  payload.content.trim() !== ''

export function renderTranscript(title: string, messages: readonly PersistedMessage[]): string {
  const turns = messages
    .filter(shown)
    .map(
      (m) =>
        `## ${m.payload.role === 'user' ? 'You' : 'Assistant'}\n\n${String(m.payload.content).trim()}`,
    )
  return `# ${title}\n\n${turns.join('\n\n')}\n`
}

const stamp = (date: Date) =>
  date
    .toISOString()
    .replace(/\.\d+Z$/, '')
    .replace(/[-:]/g, '')
    .replace('T', '-')

const slug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'chat'

/**
 * `/export [filename]`: the conversation as Markdown, the files Claude Code's `/export` writes
 * with a name given. Without one the file goes to the exports folder under the Localix home, so
 * no stray file lands in your project. An existing file is never replaced.
 */
export async function runExport(ports: ExportPorts, argument: string): Promise<string> {
  const messages = await ports.messages()
  if (!messages.some(shown)) return 'Nothing to export yet — send a message first.'
  const name = argument.trim()
  const path = name
    ? isAbsolute(name)
      ? name
      : resolve(ports.cwd, name)
    : join(ports.exportsDir, `${slug(ports.title)}-${stamp(ports.now())}.md`)
  const target = name && !extname(path) ? `${path}.md` : path
  if (await ports.exists(target)) return `\`${target}\` already exists; choose another name.`
  try {
    await ports.write(target, renderTranscript(ports.title, messages))
  } catch (error) {
    // The file was not there a moment ago (`exists`), so another writer made it since.
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      return `\`${target}\` already exists; choose another name.`
    const reason = error instanceof Error ? error.message : String(error)
    return `Could not export to \`${target}\`: ${reason}`
  }
  return `Exported this conversation to \`${target}\`.`
}
