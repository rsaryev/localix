import type { PaletteCommand } from '@/shared/contrib/uiCommands'

export interface CommandPaletteSections {
  recentCommands: PaletteCommand[]
  groups: [group: string, commands: PaletteCommand[]][]
}

/**
 * Build the command palette's visible sections without duplicating MRU entries.
 *
 * An empty query promotes live history entries into "Recently used" and removes
 * them from their ordinary groups. While searching, every command returns to its
 * declared group so cmdk can filter one complete list.
 */
export function buildCommandPaletteSections(
  commands: readonly PaletteCommand[],
  mruIds: readonly string[],
  query: string,
): CommandPaletteSections {
  const showRecent = query.trim().length === 0
  const commandsById = new Map(commands.map((command) => [command.id, command] as const))
  const recentCommands: PaletteCommand[] = []
  const recentIds = new Set<string>()

  if (showRecent) {
    for (const id of mruIds) {
      const command = commandsById.get(id)
      if (!command || recentIds.has(id)) continue
      recentIds.add(id)
      recentCommands.push(command)
    }
  }

  const commandsByGroup = new Map<string, PaletteCommand[]>()
  for (const command of commands) {
    if (recentIds.has(command.id)) continue
    const group = commandsByGroup.get(command.group)
    if (group) group.push(command)
    else commandsByGroup.set(command.group, [command])
  }

  return { recentCommands, groups: [...commandsByGroup.entries()] }
}
