import { InternalError } from '../../lib/domain-errors'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { performHandoff, type Handoff } from '@localixai/os-open'

const execFilePromise = promisify(execFile)

const splitLines = (s: string) =>
  s
    .replace(/^﻿/, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

/**
 * The PowerShell argv for a WinForms dialog script, with its stdout forced to UTF-8.
 *
 * Windows PowerShell writes redirected stdout in the console's OEM code page (437, 866, …),
 * while we decode UTF-8 — so a chosen folder like `C:\Users\Zoë\Café` came back as
 * mojibake and the project was created at a path that does not exist. Setting
 * `[Console]::OutputEncoding` (BOM-less, so the first path does not start with U+FEFF)
 * before the dialog makes the bytes match the decoder. `-STA` is required for WinForms.
 */
export function windowsDialogArgv(script: string): string[] {
  return [
    '-NoProfile',
    '-STA',
    '-NonInteractive',
    '-Command',
    `[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false; ${script}`,
  ]
}

/** Run a dialog tool for its stdout; `windowsHide` hides a console host, never the dialog. */
async function runDialog(file: string, args: string[]): Promise<string> {
  const { stdout } = await execFilePromise(file, args, { encoding: 'utf8', windowsHide: true })
  return stdout.replace(/^\uFEFF/, '')
}

const runWindowsDialog = (script: string) => runDialog('powershell', windowsDialogArgv(script))

/**
 * Native folder chooser per platform. A user cancel (or no available dialog
 * tool) resolves to `{ path: null }` rather than throwing.
 */
export async function pickDirectory(): Promise<{ path: string | null }> {
  if (process.platform === 'darwin') {
    try {
      const stdout = await runDialog('osascript', [
        '-e',
        'POSIX path of (choose folder with prompt "Select Project Directory")',
      ])
      return { path: stdout.trim() || null }
    } catch (err) {
      // -128 = user pressed Cancel in the AppleScript dialog.
      if (err instanceof Error && err.message.includes('-128')) {
        return { path: null }
      }
      throw err
    }
  }

  if (process.platform === 'win32') {
    // PowerShell FolderBrowserDialog.
    const ps =
      'Add-Type -AssemblyName System.Windows.Forms; ' +
      '$d = New-Object System.Windows.Forms.FolderBrowserDialog; ' +
      "$d.Description = 'Select Project Directory'; " +
      'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $d.SelectedPath }'
    try {
      const stdout = await runWindowsDialog(ps)
      return { path: stdout.trim() || null }
    } catch {
      // PowerShell missing or dialog unavailable (e.g. headless server).
      return { path: null }
    }
  }

  if (process.platform === 'linux') {
    // Try zenity (GTK) then kdialog (KDE); both are common but optional.
    try {
      const stdout = await runDialog('zenity', [
        '--file-selection',
        '--directory',
        '--title=Select Project Directory',
      ])
      return { path: stdout.trim() || null }
    } catch {
      /* zenity missing or cancelled — try kdialog */
    }
    try {
      const stdout = await runDialog('kdialog', ['--getexistingdirectory', os.homedir()])
      return { path: stdout.trim() || null }
    } catch {
      return { path: null }
    }
  }

  return { path: null }
}

/**
 * Native multi-file chooser per platform; mirrors {@link pickDirectory}. A user
 * cancel (or no dialog tool) resolves to `{ paths: [] }` rather than throwing.
 */
export async function pickFiles(): Promise<{ paths: string[] }> {
  if (process.platform === 'darwin') {
    try {
      const stdout = await runDialog('osascript', [
        '-e',
        'set theFiles to choose file with prompt "Select files to attach" with multiple selections allowed',
        '-e',
        'set out to ""',
        '-e',
        'repeat with f in theFiles',
        '-e',
        'set out to out & POSIX path of f & linefeed',
        '-e',
        'end repeat',
        '-e',
        'return out',
      ])
      return { paths: splitLines(stdout) }
    } catch (err) {
      if (err instanceof Error && err.message.includes('-128')) return { paths: [] }
      throw err
    }
  }

  if (process.platform === 'win32') {
    const ps =
      'Add-Type -AssemblyName System.Windows.Forms; ' +
      '$d = New-Object System.Windows.Forms.OpenFileDialog; ' +
      '$d.Multiselect = $true; ' +
      "$d.Title = 'Select files to attach'; " +
      'if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $d.FileNames -join "`n" }'
    try {
      return { paths: splitLines(await runWindowsDialog(ps)) }
    } catch {
      return { paths: [] }
    }
  }

  if (process.platform === 'linux') {
    try {
      const stdout = await runDialog('zenity', [
        '--file-selection',
        '--multiple',
        '--separator=\n',
        '--title=Select files to attach',
      ])
      return { paths: splitLines(stdout) }
    } catch {
      /* zenity missing or cancelled — try kdialog */
    }
    try {
      const stdout = await runDialog('kdialog', [
        '--getopenfilename',
        os.homedir(),
        '--multiple',
        '--separate-output',
      ])
      return { paths: splitLines(stdout) }
    } catch {
      return { paths: [] }
    }
  }

  return { paths: [] }
}

/**
 * Every path/app handoff this process makes, in one place.
 *
 * The four functions below used to carry four separate `process.platform`
 * ladders, each with its own answer to "does a failure reach anyone?" — and the
 * answer was mostly no: three of them spawned detached and dropped the error.
 * `@localixai/os-open` owns the table and the reporting now; the desktop shell
 * runs the same contract in Rust for URLs (`open_external`), which it must,
 * because a browser handoff belongs to the process the user is looking at.
 *
 * Logged unconditionally, successes included: an empty log could otherwise mean
 * either "never called" or "called and silently ignored", and those demand
 * opposite fixes.
 */
const log = (line: string) => console.info(`[native-open] ${line}`)

async function handoff(target: Handoff): Promise<{ opened: true }> {
  const result = await performHandoff(target, { log })
  if (!result.ok) throw new InternalError('os_open_failed', result.reason)
  return { opened: true }
}

/** Open a directory in the platform's file manager. */
export async function openDirectory(dir: string): Promise<{ opened: true }> {
  return handoff({ kind: 'path', path: dir })
}

/** Open a FILE in the OS default app for its type. */
export async function openPath(file: string): Promise<{ opened: true }> {
  return handoff({ kind: 'path', path: file })
}

/** Open a FILE in a specific application (macOS `open -a`; the binary elsewhere). */
export async function openPathWith(file: string, app: string): Promise<{ opened: true }> {
  return handoff({ kind: 'app', path: file, app })
}

/** Reveal/select a FILE in the OS file manager. */
export async function revealPath(file: string): Promise<{ opened: true }> {
  return handoff({ kind: 'reveal', path: file })
}
