import { useGridStore, groupOfTab, type WorkItem } from '@/features/workspace-grid/model'

export function makeTerminalItem(args: {
  sessionId: string
  terminalId: string
  owned: boolean
  title: string
  command?: string
  cwd?: string
}): WorkItem {
  return {
    kind: 'terminal',
    id: `terminal:${args.terminalId}`,
    title: args.title,
    scope: args.sessionId,
    payload: {
      sessionId: args.sessionId,
      terminalId: args.terminalId,
      owned: args.owned,
      command: args.command,
      cwd: args.cwd,
    },
  }
}

/** Open `item` as a terminal tab: reveal it if already open, else dock it into the
 *  terminal role group. `reveal:false` adds it hidden (used to pre-attach a dev
 *  server before the user looks at it). */
export function placeTerminal(item: WorkItem, opts?: { reveal?: boolean }): void {
  const grid = useGridStore.getState()
  const already = groupOfTab(grid.root, item.id)
  const group = already ? already.id : grid.resolveRoleGroup('terminal')
  grid.openItem(item, { group, activate: opts?.reveal !== false })
}
