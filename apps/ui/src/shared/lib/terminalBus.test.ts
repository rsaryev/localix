import { describe, expect, test, afterEach, beforeEach } from 'bun:test'
import { terminal } from './terminalBus'

// terminalBus is a module singleton; drain every chat's pending command and clear its sender
// around each test so they run order-independently — and leave nothing for other files.
const CHATS = ['S-A', 'S-B']
const drain = () => {
  for (const chat of CHATS) terminal.setActiveSender(chat, () => {})()
}
beforeEach(drain)
afterEach(drain)

describe('terminalBus.run', () => {
  test('strips a trailing newline before sending (paste, not execute)', () => {
    const sent: string[] = []
    const off = terminal.setActiveSender('S-A', (d: string) => sent.push(d))
    terminal.run({ sessionId: 'S-A', command: 'echo hi\n' })
    terminal.run({ sessionId: 'S-A', command: 'ls\n\n' })
    off()
    expect(sent).toEqual(['echo hi', 'ls'])
  })

  test('preserves interior newlines, only trims the trailing ones', () => {
    const sent: string[] = []
    const off = terminal.setActiveSender('S-A', (d: string) => sent.push(d))
    terminal.run({ sessionId: 'S-A', command: 'line1\nline2\n' })
    off()
    expect(sent).toEqual(['line1\nline2'])
  })

  test("a command for chat A is never pasted into chat B's pane", () => {
    // One app-wide "last registered" sender used to take every command, whichever chat's
    // transcript it came from — so B's shell, in B's directory, received A's command.
    const sentToA: string[] = []
    const sentToB: string[] = []
    const offA = terminal.setActiveSender('S-A', (d: string) => sentToA.push(d))
    const offB = terminal.setActiveSender('S-B', (d: string) => sentToB.push(d))
    terminal.run({ sessionId: 'S-A', command: 'make test' })
    offA()
    offB()
    expect(sentToA).toEqual(['make test'])
    expect(sentToB).toEqual([])
  })

  test("a command waits for its OWN chat's pane: pending is per chat", () => {
    terminal.run({ sessionId: 'S-A', command: 'queued\n' }) // no pane for A yet → pending for A
    const sentToB: string[] = []
    const offB = terminal.setActiveSender('S-B', (d: string) => sentToB.push(d))
    expect(sentToB).toEqual([]) // B's pane connecting does not take A's command

    const sentToA: string[] = []
    const offA = terminal.setActiveSender('S-A', (d: string) => sentToA.push(d)) // flushes A's
    expect(sentToA).toEqual(['queued'])
    offA()
    offB()
  })

  test("opens the named chat's terminal (via the registered opener) on run", () => {
    const opened: string[] = []
    const offOpener = terminal.setOpener((sessionId) => {
      opened.push(sessionId)
    })
    terminal.run({ sessionId: 'S-B', command: 'x' })
    offOpener()
    expect(opened).toEqual(['S-B'])
  })
})
