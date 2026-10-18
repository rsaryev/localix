/**
 * The status view of local models: pure projection of the service's state, kept apart so the
 * service holds behaviour and this holds shape.
 */
import type {
  InstallJob,
  LocalModelSpec,
  LocalModelsStatus,
  PausedDownload,
  RunningModel,
  RuntimeStatus,
} from './contracts'
import type { PartialModel } from './installer'
import type { MachineProfile } from './machine'

export function buildStatus(input: {
  runtime: RuntimeStatus
  installed: LocalModelSpec[]
  jobs: InstallJob[]
  partial: ReadonlyArray<Pick<PartialModel, 'spec' | 'received' | 'background'>>
  loaded: Array<{ id: string; status: string }>
  machine: MachineProfile | null
}): LocalModelsStatus {
  const active = new Set(input.jobs.map((j) => j.modelId))
  const paused: PausedDownload[] = input.partial
    .filter(({ spec }) => !active.has(spec.id))
    .map(({ spec, received, background }) => ({
      modelId: spec.id,
      label: spec.label,
      received,
      total: spec.bytes,
      background,
    }))
  const running: RunningModel[] = input.loaded
    .filter((m) => m.status === 'loaded' || m.status === 'loading')
    .map((m) => ({
      modelId: m.id,
      mode: input.installed.find((s) => s.id === m.id)?.kind ?? 'chat',
      state: m.status === 'loaded' ? 'ready' : 'starting',
      sinceMs: 0,
    }))
  return {
    runtime: input.runtime,
    installed: input.installed,
    jobs: input.jobs,
    paused,
    running,
    diskBytes: input.installed.reduce((n, s) => n + s.bytes, 0),
    machine: input.machine && {
      chip: input.machine.chip,
      accelerator: input.machine.accelerator,
      memoryBytes: input.machine.memoryBytes,
      modelBytes: input.machine.modelBytes,
      source: input.machine.source,
    },
  }
}
