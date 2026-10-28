import { afterEach, describe, expect, test } from 'bun:test'

import type { UiSession } from '@/shared/api/contracts'
import { terminal } from '@/shared/lib/terminalBus'
import { revealJobSession } from './useJobTerminal'
import { useChatStore } from './store'

let release: (() => void) | undefined

afterEach(() => {
  release?.()
  release = undefined
  useChatStore.setState({ activeSessionId: null, allSessions: [] })
})

/** chat-b ran `npm run dev` in the background; job-1 is that job's session. */
const sessions = [
  {
    id: 'chat-b',
    sessionKind: 'chat',
    messages: [
      {
        id: 'm1',
        role: 'assistant',
        items: [
          {
            id: 'i1',
            type: 'command',
            status: 'completed',
            toolCallId: 'tc-bg',
            name: 'Bash',
            command: 'npm run dev',
            terminalId: 'term-1',
          },
        ],
      },
    ],
  },
  { id: 'job-1', sessionKind: 'job', sourceToolCallId: 'tc-bg', messages: [] },
] as unknown as UiSession[]

describe('revealJobSession', () => {
  test("opens the job's pane in the chat that ran it, not the chat on screen", () => {
    const opened: Array<{ terminalId: string; sessionId: string; title?: string }> = []
    release = terminal.setJobOpener((args) => opened.push(args))
    useChatStore.setState({ activeSessionId: 'chat-a', allSessions: sessions })

    expect(revealJobSession('job-1')).toBe(true)
    expect(opened).toEqual([{ terminalId: 'term-1', sessionId: 'chat-b', title: 'npm run dev' }])
  })

  test('a session that is not a job is left to its caller', () => {
    release = terminal.setJobOpener(() => {
      throw new Error('must not open')
    })
    useChatStore.setState({ activeSessionId: 'chat-a', allSessions: sessions })

    expect(revealJobSession('chat-b')).toBe(false)
  })
})
