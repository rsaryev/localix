// The preflight seam itself: a capability write registered in `shared/contrib` must be
// visible to the run barrier this layer exposes. The barrier's own bookkeeping is tested
// beside it (shared/contrib/capabilityWrites.test.ts); this test owns the join, and lives
// here because `shared` may not reach up into `features`.
import { describe, expect, test } from 'bun:test'
import { trackCapabilityWrite } from '@/shared/contrib/capabilityWrites'
import { waitForRuntimeCapabilities } from './runtimeCapabilityReadiness'

describe('runtime capability readiness', () => {
  test('participates in the one agent-run capability preflight', async () => {
    let release!: () => void
    const mutation = trackCapabilityWrite(
      'project-capabilities',
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    const runBarrier = waitForRuntimeCapabilities('project-capabilities')
    expect(runBarrier).not.toBeNull()

    let ready = false
    void runBarrier!.then(() => {
      ready = true
    })
    await Promise.resolve()
    expect(ready).toBe(false)
    release()
    await mutation
    await runBarrier
    expect(ready).toBe(true)
  })
})
