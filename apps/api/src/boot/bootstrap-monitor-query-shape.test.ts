import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// The composition root was split into `bootstrap/*.ts` phase modules; the monitor host is
// constructed in the ops-timers phase. Following the code is the point of this guard — a source
// scan that no longer reaches the wiring reports -1 and would pass vacuously if it only checked
// the CONTENTS.
const source = readFileSync(resolve(import.meta.dir, '../bootstrap/ops-timers.ts'), 'utf8')
const monitorStart = source.indexOf('const monitorHost = createPluginMonitorHost(')
// The host's start moved onto the idle scheduler (`startup.idle_tasks`), so its construction
// ends where it is published to the host refs.
const monitorEnd = source.indexOf('hostRefs.monitorHost = monitorHost', monitorStart)
const monitorWiring = source.slice(monitorStart, monitorEnd)

describe('plugin monitor boot wiring', () => {
  test('wakes only the sessions the line names, never a roster of the user', () => {
    // Each line used to wake every root chat of the user (`listMonitorWakeSessionIds`), because
    // nothing named the conversation a watcher was for. The sessions now come from the arm.
    expect(monitorStart).toBeGreaterThan(-1)
    expect(monitorEnd).toBeGreaterThan(monitorStart)
    expect(monitorWiring).toContain('note.sessionIds')
    expect(monitorWiring).not.toContain('listMonitorWakeSessionIds')
    expect(monitorWiring).not.toContain('listSessions(')
    expect(monitorWiring).not.toMatch(/chatService\s*\.\s*list/)
  })

  test('a line nobody armed is reported, not delivered', () => {
    expect(monitorWiring).toContain('unaddressed:')
    expect(monitorWiring).toContain('hostRefs.wakes!.unaddressed(')
  })

  test('a line reaches a BUSY session too, through the one wake delivery', () => {
    // Skipping a running session dropped the line for exactly the sessions that were working;
    // the wake queue is what holds a wake until the session can take it.
    const deliver = monitorWiring
    expect(deliver.length).toBeGreaterThan(0)
    expect(deliver).not.toContain('isRunning(')
    expect(deliver).not.toContain('.wakeSession(')
    expect(deliver).toContain('hostRefs.wakes!.send(')
  })
})
