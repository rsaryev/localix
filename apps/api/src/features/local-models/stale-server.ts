/**
 * Reaping a model server an earlier API process left behind.
 *
 * The orphan guard kills our children on a normal or fatal exit, but nothing runs when the API
 * itself is SIGKILLed and its watchdog is gone too: the router — detached into its own process
 * group — survives with gigabytes of model in memory. The router's claim (router-claim.ts) names
 * its pid, and a later start kills a recorded process that is still alive AND still ours: its
 * command line names our presets file. A pid the OS has handed to anything else is left alone.
 */
import { execFile } from 'node:child_process'
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

/** Kill `pid` with its group when it is alive and its command line still names `marker`. */
export async function reapServerPid(pid: number, marker: string): Promise<boolean> {
  if (!Number.isFinite(pid) || pid <= 0 || !isAlive(pid)) return false
  const command = await commandOf(pid)
  if (!command?.includes(marker)) return false
  killProcessTree(pid, 2000, () => isAlive(pid))
  return true
}
