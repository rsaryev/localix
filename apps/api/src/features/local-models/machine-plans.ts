import { planFor } from './catalog-rank'
import type { LocalModelSpec } from './contracts'
import { readShape } from './gguf-header'
import type { installPaths } from './installer'
import { detectMachine, type MachineProfile } from './machine'
import type { ModelPlan } from './planner'

/**
 * This computer's profile and how each installed model runs on it. The computer is profiled once
 * (again when the runtime arrives and can report its devices), and every installed model is
 * planned for it before the router serves it.
 */
export interface MachinePlansDeps {
  paths: ReturnType<typeof installPaths>
  detect?: (executable: string | null) => Promise<MachineProfile>
  /** The runtime executable once it is installed: llama.cpp's own device list. */
  executable: () => string | null
  installed: () => readonly LocalModelSpec[]
}

export function createMachinePlans(deps: MachinePlansDeps) {
  let machine: MachineProfile | null = null
  const plans = new Map<string, ModelPlan | null>()

  /** How an installed model runs here, from its own header on disk. */
  async function planInstalled(spec: LocalModelSpec) {
    if (!machine || spec.kind !== 'chat') return null
    const weights = spec.files.find((f) => f.role === 'weights')
    const shape = weights
      ? await readShape(deps.paths.modelFile(spec.id, weights.name)).catch(() => null)
      : null
    return planFor(spec, machine, shape)
  }

  /** Plan every installed model for this computer: the router starts it so, the provider says so. */
  async function replan() {
    plans.clear()
    for (const spec of deps.installed()) plans.set(spec.id, await planInstalled(spec))
  }

  return {
    profile: (): MachineProfile | null => machine,
    planOf: (modelId: string): ModelPlan | null => plans.get(modelId) ?? null,
    replan,
    /** Profile this computer (a failed probe keeps the last profile), then plan again. */
    async detect() {
      machine = await (deps.detect ?? detectMachine)(deps.executable()).catch(() => machine)
      await replan()
    },
  }
}
