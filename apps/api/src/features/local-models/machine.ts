/**
 * This computer, as the planner needs it: where models run (Metal, CUDA, Vulkan or the CPU), how
 * much memory they may take, and how fast that memory is.
 *
 * With the runtime installed, llama.cpp itself is asked (`--list-devices`): on Apple Silicon its
 * Metal total is the GPU working-set limit macOS recommends, which is what a model may actually
 * use. Before that, the figure is estimated the same way macOS sets it. Either way a reserve stays
 * for everything else running: 10% of system memory (at least 2 GiB), 5% of a dedicated GPU's
 * (at least 512 MiB) — the reserves Magnitude plans with.
 */
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import { bandwidthOf } from './bandwidth'

export type Accelerator = 'metal' | 'cuda' | 'vulkan' | 'cpu'

export interface MachineProfile {
  chip: string | null
  accelerator: Accelerator
  /** CPU and GPU share one memory (Apple Silicon). */
  unified: boolean
  memoryBytes: number
  /** Memory a model may take where it runs, after the reserve. */
  modelBytes: number
  /** System memory a dedicated GPU can spill layers into (0 when unified). */
  hostModelBytes: number
  /** Bytes per second where the model runs, and of system memory. */
  bandwidth: number
  hostBandwidth: number
  /** `runtime`: measured by llama.cpp; `estimate`: worked out before it is installed. */
  source: 'runtime' | 'estimate'
}

export interface RuntimeDevice {
  id: string
  name: string
  totalBytes: number
  freeBytes: number
}

const MIB = 2 ** 20
const GIB = 2 ** 30

/** `  MTL0: Apple M5 (18186 MiB, 18185 MiB free)` → a device. BLAS/CPU lines carry no memory. */
export function parseDevices(output: string): RuntimeDevice[] {
  const devices: RuntimeDevice[] = []
  for (const line of output.split('\n')) {
    const m = /^\s*([A-Za-z]+\d*):\s*(.+?)\s*\((\d+) MiB, (\d+) MiB free\)/.exec(line)
    if (!m || Number(m[3]) === 0) continue
    devices.push({
      id: m[1]!,
      name: m[2]!,
      totalBytes: Number(m[3]) * MIB,
      freeBytes: Number(m[4]) * MIB,
    })
  }
  return devices
}

function acceleratorOf(deviceId: string): Accelerator {
  if (deviceId.startsWith('MTL')) return 'metal'
  if (deviceId.startsWith('CUDA')) return 'cuda'
  if (deviceId.startsWith('Vulkan')) return 'vulkan'
  return 'cpu'
}

const hostReserve = (total: number) => Math.max(total * 0.1, 2 * GIB)
const gpuReserve = (total: number) => Math.max(total * 0.05, 512 * MIB)

/** macOS lets the GPU wire about two thirds of memory up to 16 GB, three quarters above. */
const appleWorkingSet = (memory: number) => memory * (memory <= 16 * GIB ? 2 / 3 : 0.75)

export function profileFrom(input: {
  platform: NodeJS.Platform
  arch: string
  memoryBytes: number
  cpu: string | null
  devices: RuntimeDevice[] | null
}): MachineProfile {
  const { memoryBytes } = input
  const host = Math.max(0, memoryBytes - hostReserve(memoryBytes))
  const cpuBandwidth = bandwidthOf(input.cpu, 'cpu')
  const apple = input.platform === 'darwin' && input.arch === 'arm64'
  const device = input.devices?.[0]
  if (apple) {
    const workingSet = device?.totalBytes ?? appleWorkingSet(memoryBytes)
    const bandwidth = bandwidthOf(input.cpu, 'apple')
    return {
      chip: input.cpu,
      accelerator: 'metal',
      unified: true,
      memoryBytes,
      modelBytes: Math.max(0, Math.min(memoryBytes, workingSet) - hostReserve(memoryBytes)),
      hostModelBytes: 0,
      bandwidth,
      hostBandwidth: bandwidth,
      source: device ? 'runtime' : 'estimate',
    }
  }
  if (device) {
    const integrated = device.totalBytes >= memoryBytes * 0.9
    return {
      chip: device.name,
      accelerator: acceleratorOf(device.id),
      unified: integrated,
      memoryBytes,
      modelBytes: integrated
        ? host
        : Math.max(0, device.totalBytes - gpuReserve(device.totalBytes)),
      hostModelBytes: integrated ? 0 : host,
      bandwidth: bandwidthOf(device.name, integrated ? 'integrated' : 'dedicated'),
      hostBandwidth: cpuBandwidth,
      source: 'runtime',
    }
  }
  return {
    chip: input.cpu,
    accelerator: 'cpu',
    unified: true,
    memoryBytes,
    modelBytes: host,
    hostModelBytes: 0,
    bandwidth: cpuBandwidth,
    hostBandwidth: cpuBandwidth,
    source: 'estimate',
  }
}

function capture(command: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    const child = spawn(command, args, { timeout: 5_000, killSignal: 'SIGKILL', windowsHide: true })
    child.stdout.on('data', (d: Buffer) => chunks.push(d))
    child.stderr.on('data', (d: Buffer) => chunks.push(d))
    child.on('error', () => resolve(null))
    // Decoded once, whole: a multi-byte character may straddle two chunks.
    child.on('close', (code) => resolve(code === 0 ? Buffer.concat(chunks).toString('utf8') : null))
  })
}

async function cpuName(): Promise<string | null> {
  if (process.platform === 'darwin') {
    return (await capture('sysctl', ['-n', 'machdep.cpu.brand_string']))?.trim() || null
  }
  if (process.platform === 'linux') {
    const info = await readFile('/proc/cpuinfo', 'utf8').catch(() => '')
    return /model name\s*:\s*(.+)/.exec(info)?.[1]?.trim() ?? null
  }
  return os.cpus()[0]?.model?.trim() || null
}

/** An NVIDIA GPU before the runtime is installed, from the driver's own tool. */
async function nvidiaDevices(): Promise<RuntimeDevice[] | null> {
  const out = await capture('nvidia-smi', [
    '--query-gpu=name,memory.total,memory.free',
    '--format=csv,noheader,nounits',
  ])
  if (!out) return null
  const devices = out
    .trim()
    .split('\n')
    .map((line) => line.split(',').map((s) => s.trim()))
    .filter((parts) => parts.length === 3)
    .map(([name, total, free], i) => ({
      id: `CUDA${i}`,
      name: name!,
      totalBytes: Number(total) * MIB,
      freeBytes: Number(free) * MIB,
    }))
  return devices.length ? devices : null
}

/** Profile this computer; `executable` is llama-server when the runtime is installed. */
export async function detectMachine(executable: string | null): Promise<MachineProfile> {
  const listed = executable ? await capture(executable, ['--list-devices']) : null
  const devices = listed !== null ? parseDevices(listed) : await nvidiaDevices()
  return profileFrom({
    platform: process.platform,
    arch: process.arch,
    memoryBytes: os.totalmem(),
    cpu: await cpuName(),
    devices,
  })
}
