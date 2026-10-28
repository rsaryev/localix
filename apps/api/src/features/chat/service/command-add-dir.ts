import { isAbsolute, resolve } from 'node:path'

import type { AddDirectoryResult } from '../../cc-settings/settings-directories'
import { expandHome, isHomePath } from '../../../lib/home-path'

export interface AddDirPorts {
  cwd: string
  homeDir: string
  isDirectory(path: string): Promise<boolean>
  add(directory: string): AddDirectoryResult
}

const expand = (arg: string, ports: Pick<AddDirPorts, 'cwd' | 'homeDir'>) =>
  isAbsolute(arg) || isHomePath(arg)
    ? resolve(expandHome(arg, ports.homeDir))
    : resolve(ports.cwd, arg)

/**
 * `/add-dir <path>`: a folder the agent may then read and change as it does the project's. It is
 * remembered in the project's local Claude Code settings (`permissions.additionalDirectories`),
 * which every run reads, so it applies from the next message, and to this folder's later chats.
 */
export async function runAddDir(ports: AddDirPorts, argument: string): Promise<string> {
  const arg = argument.trim()
  if (!arg) return 'Usage: /add-dir <path> — a folder the agent may work in besides the project.'
  const directory = expand(arg, ports)
  if (!(await ports.isDirectory(directory))) return `\`${directory}\` is not a folder.`
  const result = ports.add(directory)
  if (result.status === 'unreadable')
    return `\`${result.file}\` is not valid JSON, so it was left as it is. Fix it, then run \`/add-dir\` again.`
  if (result.status === 'present') return `\`${directory}\` is already one of the added folders.`
  return `Added \`${directory}\` to \`${result.file}\`. The agent may work there from the next message, as it does in the project, and so may later chats in this folder.`
}
