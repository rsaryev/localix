import { useGridStore, groupOfTab, type WorkItem } from '@/entities/workspace-grid/model'
import { useChatStore } from '@/entities/chat/model/store'
import { projectDirOf } from './terminalFolderMove'

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
      // The project folder it started under: a later move of the project is then told apart from
      // a terminal started somewhere else (`terminalFolderMove`).
      projectDir: projectDirOf(useChatStore.getState(), args.sessionId),
    },
  }
}

/** Open `item` as a terminal tab: reveal it if already open, else dock it into the
 *  terminal role group. Only someone's explicit open reaches here, so it always takes focus. */
export function placeTerminal(item: WorkItem): void {
  const grid = useGridStore.getState()
  const already = groupOfTab(grid.root, item.id)
  const group = already ? already.id : grid.resolveRoleGroup('terminal')
  grid.openItem(item, { group, activate: true })
}
