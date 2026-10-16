/**
 * Monitors, assembled — in the one order their parts allow.
 *
 * The cycle this resolves: the trigger engine is built from its actions, so the `monitor` action
 * must exist first; the service arms and ends triggers, so it needs the finished engine. Hence two
 * steps — `createMonitors` yields the action to register, and `bind` takes the engine it was
 * registered in and yields the service. The report and the credentials are the parts both halves
 * share, built once here so a fire and a stop see the same card hooks, log and environment.
 */
import type { TriggerEngine } from '../triggers/engine'
import type { WorkRegistry } from '../work/registry'
import { createMonitorAction } from './action'
import { createMonitorCredentials, type MonitorCredentialsDeps } from './credentials'
import { createMonitorReport, type MonitorReportDeps } from './report'
import { createMonitorService, type MonitorServiceDeps } from './service'
import { nativeCheckRun } from './sources/native'
import type { CheckRun } from './sources'

export interface MonitorsDeps
  extends
    Omit<MonitorReportDeps, 'work'>,
    MonitorCredentialsDeps,
    Pick<MonitorServiceDeps, 'spawn' | 'createSource' | 'tuning' | 'logger'> {
  work: Pick<WorkRegistry, 'mint' | 'adopt' | 'recordEvents' | 'end'>
  runCheck?: CheckRun
  now?: () => Date
}

export function createMonitors(deps: MonitorsDeps) {
  const now = deps.now ?? (() => new Date())
  const report = createMonitorReport(deps)
  const credentials = createMonitorCredentials(deps)
  let engine: Pick<TriggerEngine, 'get'> | null = null
  const action = createMonitorAction({
    report,
    credentials,
    runCheck: deps.runCheck ?? nativeCheckRun,
    isLive: (id) => engine?.get(id) !== undefined,
    now,
  })
  return {
    action,
    /** The engine `action` was registered in; answers the service that arms and ends through it. */
    bind(triggers: MonitorServiceDeps['triggers']) {
      engine = triggers
      return createMonitorService({
        triggers,
        work: deps.work,
        report,
        credentials,
        now: () => now().getTime(),
        ...(deps.spawn ? { spawn: deps.spawn } : {}),
        ...(deps.createSource ? { createSource: deps.createSource } : {}),
        ...(deps.tuning ? { tuning: deps.tuning } : {}),
        ...(deps.logger ? { logger: deps.logger } : {}),
      })
    },
  }
}
