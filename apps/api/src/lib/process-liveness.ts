/** Whether `pid` still exists. EPERM means it exists but belongs to someone else. */
export function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== 'ESRCH'
  }
}

/** Poll until `pid` exits or `graceMs` elapses; true when it is gone. */
export async function awaitPidGone(pid: number, graceMs: number, pollMs = 25): Promise<boolean> {
  const deadline = Date.now() + graceMs
  while (Date.now() < deadline) {
    if (!processIsAlive(pid)) return true
    await Bun.sleep(pollMs)
  }
  return !processIsAlive(pid)
}
