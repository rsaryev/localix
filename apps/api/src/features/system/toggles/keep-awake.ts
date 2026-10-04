import { spawn, type ChildProcess } from 'node:child_process'
import { errorMessage } from '../../../lib/errors'
import type { SystemToggleDef } from '../toggle'

/**
 * "Keep this machine awake" — holds an OS sleep-inhibitor for as long as it's on,
 * so a long agent run / channel session isn't interrupted by the laptop sleeping.
 * Implemented by spawning the platform's inhibitor and killing it to release:
 *   - macOS:   `caffeinate -dimsu`
 *   - Linux:   `systemd-inhibit … sleep infinity`
 *   - Windows: a PowerShell loop holding SetThreadExecutionState
 * Killing the child releases the lock (the OS resets the request on exit).
 */
export function createKeepAwakeToggle(logger?: {
  warn: (msg: string, meta?: unknown) => void
}): SystemToggleDef {
  let child: ChildProcess | null = null

  const command = (): { cmd: string; args: string[] } | null => {
    switch (process.platform) {
      case 'darwin':
        // Prevent display, idle, disk, and system sleep while asserted.
        return { cmd: 'caffeinate', args: ['-dimsu'] }
      case 'linux':
        // Block idle + sleep until the held process exits.
        return {
          cmd: 'systemd-inhibit',
          args: [
            '--what=idle:sleep',
            '--who=LocalixAI',
            '--why=Keep awake',
            '--mode=block',
            'sleep',
            'infinity',
          ],
        }
      case 'win32':
        // ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED = 0x80000003.
        return {
          cmd: 'powershell.exe',
          args: [
            '-NoProfile',
            '-WindowStyle',
            'Hidden',
            '-Command',
            '$s=\'[DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint e);\';' +
              '$p=Add-Type -MemberDefinition $s -Name Power -Namespace Win32 -PassThru;' +
              '$p::SetThreadExecutionState(0x80000003) | Out-Null;' +
              'while($true){ Start-Sleep -Seconds 60 }',
          ],
        }
      // No inhibitor we know of — `isAvailable` reports the toggle as unsupported.
      case 'aix':
      case 'android':
      case 'cygwin':
      case 'freebsd':
      case 'haiku':
      case 'netbsd':
      case 'openbsd':
      case 'sunos':
        return null
    }
  }

  return {
    id: 'keep-awake',
    title: 'Keep awake',
    description: 'Stop this computer from sleeping while LocalixAI is running.',
    isAvailable: () => command() !== null,
    enable() {
      if (child && !child.killed) return // already holding the lock
      const spec = command()
      if (!spec) throw new Error(`Keep awake is not supported on ${process.platform}`)
      const proc = spawn(spec.cmd, spec.args, { stdio: 'ignore', windowsHide: true })
      proc.on('error', (err) => {
        logger?.warn('keep-awake inhibitor failed to start', { error: errorMessage(err) })
        if (child === proc) child = null
      })
      proc.on('exit', () => {
        if (child === proc) child = null
      })
      child = proc
    },
    disable() {
      if (child && !child.killed) child.kill()
      child = null
    },
  }
}
