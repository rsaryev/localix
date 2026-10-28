/**
 * The watchdog that reaps tracked groups when the API dies by SIGKILL.
 *
 * One tiny detached `sh` per API process: it wakes every second, and once the API pid is gone
 * (or the pidfile was removed by a clean exit — then it just leaves) it SIGKILLs every group in
 * the pidfile and deletes it. It sits in its own group, so the death of the API does not take
 * it along, and it is NOT tracked: it ends itself within one tick of the API. Not started on
 * Windows (no `sh`); the next API start reaps the pidfile instead.
 *
 * The shell applies the same pid-reuse rule as orphan-guard-pidfile.ts: a live leader is killed
 * only when its `ps -o lstart=` still equals the recorded token.
 */
import { spawn } from 'node:child_process'

const SCRIPT = `
api=$1; file=$2
while kill -0 "$api" 2>/dev/null && [ -f "$file" ]; do sleep 1; done
[ -f "$file" ] || exit 0
while IFS='|' read -r pg tok; do
  [ -n "$pg" ] || continue
  if [ -n "$tok" ]; then
    cur=$(ps -o lstart= -p "$pg" 2>/dev/null); set -- $cur; cur="$*"
    if [ -n "$cur" ] && [ "$cur" != "$tok" ]; then continue; fi
  fi
  kill -KILL -- "-$pg" 2>/dev/null
done < "$file"
rm -f "$file"
`

export interface Watchdog {
  stop: () => void
}

/** Start the watchdog for `apiPid` over `pidfile`. Returns null where it cannot run. */
export function startWatchdog(apiPid: number, pidfile: string): Watchdog | null {
  if (process.platform === 'win32') return null
  try {
    const child = spawn('sh', ['-c', SCRIPT, 'sh', String(apiPid), pidfile], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.on('error', () => {})
    child.unref()
    const pid = child.pid
    return {
      stop: () => {
        if (!pid) return
        try {
          process.kill(-pid, 'SIGKILL')
        } catch {
          /* already gone */
        }
      },
    }
  } catch {
    return null
  }
}
