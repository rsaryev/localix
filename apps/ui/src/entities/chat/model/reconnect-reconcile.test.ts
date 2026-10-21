import { describe, expect, test } from 'bun:test'
import { reconcileAfterReconnect } from './reconnect-reconcile'

interface Session {
  id: string
  version: number
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('reconcileAfterReconnect', () => {
  test('retries instead of overwriting replay that landed during REST', async () => {
    let current: Session | undefined = { id: 's1', version: 1 }
    const first = deferred<Session>()
    const second = deferred<Session>()
    let calls = 0
    const applied: Session[] = []
    const run = reconcileAfterReconnect({
      sessionId: 's1',
      getCurrent: () => current,
      isStillTarget: () => true,
      fetchSession: () => (++calls === 1 ? first.promise : second.promise),
      applySession: (session) => {
        applied.push(session)
        current = session
      },
    })

    current = { id: 's1', version: 2 } // replayed message/tool result
    first.resolve({ id: 's1', version: 1 }) // stale GET must not win
    await Promise.resolve()
    second.resolve({ id: 's1', version: 2 })

    expect(await run).toBe(true)
    expect(calls).toBe(2)
    expect(applied).toEqual([{ id: 's1', version: 2 }])
  })

  test('fails honestly when every request races newer stream state', async () => {
    let current: Session | undefined = { id: 's1', version: 1 }
    let calls = 0
    const applied: Session[] = []
    const result = await reconcileAfterReconnect({
      sessionId: 's1',
      getCurrent: () => current,
      isStillTarget: () => true,
      fetchSession: async () => {
        calls += 1
        const fetched = current!
        current = { ...current!, version: current!.version + 1 }
        return fetched
      },
      applySession: (session) => applied.push(session),
    })
    expect(result).toBe(false)
    expect(calls).toBe(2)
    expect(applied).toEqual([])
  })

  test('does not apply after focus moved to another session', async () => {
    const gate = deferred<Session>()
    let active = 's1'
    const applied: Session[] = []
    const run = reconcileAfterReconnect({
      sessionId: 's1',
      getCurrent: () => ({ id: 's1', version: 1 }),
      isStillTarget: () => active === 's1',
      fetchSession: () => gate.promise,
      applySession: (session) => applied.push(session),
    })
    active = 's2'
    gate.resolve({ id: 's1', version: 2 })
    expect(await run).toBe(false)
    expect(applied).toEqual([])
  })
})
