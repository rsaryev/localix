/**
 * The timeout line names the likely cause when the output had already ended: a script whose
 * timers, servers or open handles keep the runtime alive after its work is done (a Node test
 * that leaves the app's `setInterval` running: 60 s of waiting for output
 * that had finished 59 s earlier). Without the hint the model reads the same result as "slow".
 */
export function timeoutNotice(timeoutSecs: number, output: string): string {
  const hint = output.trim()
    ? ' — the output had ended, so the process was kept alive by something else (timers, servers, open handles). Make the script exit when done, or run it with background:true if it must keep running.'
    : ''
  return `[Timed out after ${timeoutSecs}s${hint}]`
}
