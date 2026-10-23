/**
 * Executes the shell-command install plan (see plan.ts) against the filesystem —
 * the runtime behind "Install the `localix` command" (Settings / first-run). Writes
 * a user-writable launcher (no sudo), reports whether its bin dir is on PATH, and
 * can cleanly uninstall. All host facts (platform/home/PATH/CLI entry) are injected
 * so the logic is testable and the caller (bootstrap) supplies real values.
 *
 * PATH-rc editing is deliberately NOT done here — it's fragile and shell-specific;
 * instead `status`/`install` report `onPath` + the dir so the UI can guide the user.
 */

import { ConflictError } from '../../lib/domain-errors'
import { chmod, mkdir, readFile, rm, stat } from 'node:fs/promises'

import { atomicWriteFile } from '@localixai/mini-app-sdk/backend'

import { isDirOnPath, planShellCommand, type ShellCommandPlanInput } from './plan'

export type ShellCommandState = 'installed' | 'stale' | 'not-installed'

export interface ShellCommandStatus {
  state: ShellCommandState
  /** The launcher path (whether or not it exists yet). */
  targetPath: string
  /** Its bin dir. */
  binDir: string
  /** Whether binDir is already on PATH (else the user must add it). */
  onPath: boolean
  /** True when the platform/host is wired for install (cliEntry + bun resolved). */
  available: boolean
}

export interface ShellCommandServiceDeps extends ShellCommandPlanInput {
  /** The PATH env string to test membership against. */
  pathEnv: string
  /** False when the CLI entry / bun couldn't be resolved (e.g. plain web run). */
  available?: boolean
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

export function createShellCommandService(deps: ShellCommandServiceDeps) {
  const available = deps.available ?? true
  const plan = planShellCommand(deps)
  const onPath = isDirOnPath(plan.binDir, deps.pathEnv, deps.platform)

  const baseStatus = (state: ShellCommandState): ShellCommandStatus => ({
    state,
    targetPath: plan.targetPath,
    binDir: plan.binDir,
    onPath,
    available,
  })

  return {
    async status(): Promise<ShellCommandStatus> {
      if (!available || !(await pathExists(plan.targetPath))) {
        return baseStatus('not-installed')
      }
      // Installed — is it current? The launcher embeds the CLI entry path.
      const current = await readFile(plan.targetPath, 'utf8').catch(() => '')
      return baseStatus(current.includes(deps.cliEntry) ? 'installed' : 'stale')
    },

    async install(): Promise<ShellCommandStatus> {
      if (!available) {
        throw new ConflictError(
          'shell_command_unavailable',
          'shell command install is unavailable in this runtime',
        )
      }
      await mkdir(plan.binDir, { recursive: true })
      await atomicWriteFile(plan.targetPath, plan.launcher, { mode: plan.mode })
      if (plan.kind === 'posix-script') await chmod(plan.targetPath, plan.mode)
      return baseStatus('installed')
    },

    async uninstall(): Promise<ShellCommandStatus> {
      await rm(plan.targetPath, { force: true })
      return baseStatus('not-installed')
    },
  }
}

export type ShellCommandService = ReturnType<typeof createShellCommandService>
