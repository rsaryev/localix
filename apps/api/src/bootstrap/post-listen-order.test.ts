import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (file: string): string => readFileSync(join(import.meta.dir, file), 'utf8')

function expectInOrder(source: string, markers: readonly string[]): void {
  let previous = -1
  for (const marker of markers) {
    const current = source.indexOf(marker)
    expect(current, `missing boot-order marker: ${marker}`).toBeGreaterThan(previous)
    previous = current
  }
}

describe('post-listen bootstrap order', () => {
  // READY used to wait on the user's rc files (a blocking probe before publish): 330 ms on a
  // cache miss, up to 10 s against the desktop shell's 12 s deadline. The probe now runs
  // after bind WITHOUT gating publish, and everything that spawns from `process.env` waits
  // for it — so the order below is the whole invariant.
  test('binds, starts the env probe, publishes without waiting on it; spawners wait', () => {
    expectInOrder(read('../index.ts'), [
      'server = listen(runtime.env.PORT)',
      'runtime.startPostListen(postListen.signal)',
      'await publishRuntimeEndpoint(',
    ])
    expect(read('../index.ts')).not.toContain('await runtime.startPostListen(')

    expectInOrder(read('../bootstrap.ts'), [
      'const startPostListen = (signal?: AbortSignal): Promise<void> => {',
      'const envReady = loadLoginShellEnv()',
      'return envReady.then(() => {',
      'if (signal?.aborted) return',
      'startBackendHost()',
      'startEngines()',
      // The signal reaches the ops timers since their first runs moved onto the idle
      // scheduler: a stop during its wait must keep a plugin host from starting after it.
      'startOpsTimers(signal)',
    ])
  })

  // The first UI burst used to compete with every maintenance job at once, and one of them (the
  // usage reconcile) held the loop ~240 ms in a single synchronous statement. Each first run is
  // now an entry of ONE idle list; a direct call beside it is the regression.
  test('post-listen maintenance runs from the idle scheduler, not on the env-ready turn', () => {
    const source = read('ops-timers.ts')
    expectInOrder(source, [
      'const idleTasks: IdleTask[] = [',
      "{ name: 'plugin_channels', run: () => channelHost.start() }",
      "{ name: 'plugin_monitors', run: () => monitorHost.start() }",
      "name: 'staging_report'",
      "{ name: 'delegation_recovery', run: recoverReports }",
      "name: 'usage_reconcile'",
      'reconcileUsageInSlices(',
      "name: 'session_data_sweep'",
      "{ name: 'skills_curator', run: runCuratorCheck }",
      'void runIdleTasks(idleTasks, {',
    ])
    // Outside that list, a first run as its own STATEMENT is the regression (an interval's
    // callback is a later run, not a first one).
    const outside =
      source.slice(0, source.indexOf('const idleTasks: IdleTask[] = [')) +
      source.slice(source.indexOf('void runIdleTasks(idleTasks, {'))
    for (const direct of [
      /^\s*(void )?channelHost\.start\(\)/m,
      /^\s*(void )?monitorHost\.start\(\)/m,
      /^\s*(void )?recoverReports\(\)/m,
      /^\s*(void )?runCuratorCheck\(\)/m,
      /^\s*(void )?sweepOrphanSessionData\(/m,
      /reconcileAssistantMessageEvents\(/,
    ]) {
      expect(outside, `direct post-listen call: ${direct}`).not.toMatch(direct)
    }
    // Positive control: the detector sees the shape the old code had.
    expect('    void recoverReports()\n').toMatch(/^\s*(void )?recoverReports\(\)/m)
  })

  // A reopen right after quit attached to the dying runtime: its descriptor and a 200
  // `/health` outlived most of the teardown. The drain must be visible before it is slow.
  test('shutdown turns undiscoverable before any slow teardown step', () => {
    expectInOrder(read('../index.ts'), [
      'if (shutdownPromise) return shutdownPromise',
      'draining = true',
      'postListen.abort()',
      "cleanup('clearRuntimeEndpoint'",
      // Client connections close before the subsystems they could reach are stopped.
      "cleanup('server.stop'",
      "cleanup('channelHost.stop'",
      "cleanup('ownership.release'",
      "cleanup('uninstallSignalHandlers'",
    ])
  })

  test('keeps phases with ungated consumers complete before bootstrap returns', () => {
    expectInOrder(read('infra.ts'), [
      'await migrateToLatest(',
      'await bootRepo.markRunningSessionsStopped()',
      'await migrateLegacySecrets({',
      'return {',
    ])
    // Loops and monitors are bound and hydrated before bootstrap returns; their deadlines start
    // post-listen. Work a resumed monitor did not take back is lost only after the triggers load.
    expectInOrder(read('triggers.ts'), [
      'setLoopEngine(loops)',
      'setMonitorService(serviceRefs.monitorService)',
      'await triggerEngine.hydrate()',
      'await serviceRefs.monitorService.resume()',
      'await work.losePending()',
    ])
    expectInOrder(read('engines.ts'), [
      'await wireTriggers(',
      'const startEngines = (): void => {',
      'triggerEngine.start()',
    ])
  })
})
