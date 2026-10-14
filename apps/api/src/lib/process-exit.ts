/**
 * Shared classification of child-process exit codes for run/job status.
 *
 * A process killed by signal N exits with 128+N. The graceful STOP signals below
 * mean the process was TOLD to stop — a dev-server hot-reload SIGTERMs the whole
 * process group, a terminal sends ^C (SIGINT), an orchestrator SIGKILLs a tree —
 * which is NOT a logic failure. CRASH signals (SIGABRT 134, SIGSEGV 139, SIGBUS
 * 135, SIGFPE 136, SIGILL 132) are deliberately EXCLUDED: those are real failures.
 *
 * Used by both the bash background-job classifier and the CLI-agent executor host
 * so "a healthy job that watch-mode reload killed" never reads as `failed`.
 * See [worker-stopped-is-hot-reload].
 */
const TERMINATION_EXITS = new Set([129, 130, 137, 143]) // SIGHUP, SIGINT, SIGKILL, SIGTERM

export function isTerminationSignalExit(exitCode: number | null | undefined): boolean {
  return exitCode != null && TERMINATION_EXITS.has(exitCode)
}
