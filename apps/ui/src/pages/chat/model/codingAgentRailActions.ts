import { createElement } from 'react'
import { ClaudeMark, CodexMark } from '@localixai/kit/coding-agent-marks'
import type { RailAction } from '@/widgets/workspace-shell'
import { openCommandTerminal } from '@/features/terminal/model/terminalTabs'
import { requireOpenChat } from '@/shared/lib/pageOpenChat'

/** Core shortcuts use the same placement, pin and drag model as every customizable entry. */
export function codingAgentRailActions(openSessionId: string | null): RailAction[] {
  return [
    { id: 'coding-agent:claude', label: 'Claude Code', command: 'claude', Mark: ClaudeMark },
    { id: 'coding-agent:codex', label: 'Codex', command: 'codex', Mark: CodexMark },
  ].map(({ id, label, command, Mark }) => ({
    id,
    label,
    statusLabel: label,
    icon: createElement(Mark, { className: 'size-4.5' }),
    customizable: true,
    toolCategory: 'utilities',
    defaultArea: 'status',
    onClick: () => {
      const sessionId = requireOpenChat(openSessionId)
      if (sessionId) void openCommandTerminal(sessionId, command, label)
    },
  }))
}
