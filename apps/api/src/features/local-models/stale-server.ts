/**
 * Reaping a model server an earlier API process left behind.
 *
 * The orphan guard kills our children on a normal or fatal exit, but nothing runs when the API
 * itself is SIGKILLed (a crash, a force-quit, a development restart): the router — detached into
 * its own process group — survives with gigabytes of model in memory. So each router start
 * records its pid, and the next start kills a recorded process that is still alive AND still
 * ours: its command line names our presets file. A pid the OS has handed to anything else is
 * left alone.
 */
import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { isAlive, killProcessTree } from '../../lib/process-tree'

const execFileAsync = promisify(execFile)

/** The command line of a live pid, or null (gone, or unreadable on this platform). */
async function commandOf(pid: number): Promise<string | null> {
  if (process.platform === 'win32') return null
  try {
    const { stdout } = await execFileAsync('ps', ['-o', 'command=', '-p', String(pid)], {
      timeout: 5000,
      killSignal: 'SIGKILL',
      windowsHide: true,
    })
    return stdout.trim() || null
  } catch {
    return null
  }
}

export async function reapStaleServer(pidFile: string, marker: string): Promise<boolean> {
  const raw = await readFile(pidFile, 'utf8').catch(() => null)
  const pid = raw ? Number.parseInt(raw, 10) : Number.NaN
  await rm(pidFile, { force: true })
  if (!Number.isFinite(pid) || pid <= 0 || !isAlive(pid)) return false
  const command = await commandOf(pid)
  if (!command?.includes(marker)) return false
  killProcessTree(pid, 2000, () => isAlive(pid))
  return true
}

export async function recordServer(pidFile: string, pid: number): Promise<void> {
  await mkdir(path.dirname(pidFile), { recursive: true })
  await writeFile(pidFile, String(pid))
}

export async function forgetServer(pidFile: string): Promise<void> {
  await rm(pidFile, { force: true })
}
