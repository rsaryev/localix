import { claudeCodeHome } from '../features/cc-settings/config-dir'
import { carryAutoMemory } from '../features/memory/auto-memory'
import { claudeCodeTrusts } from '../features/plugins/kit'
import type { ClaudeCodeFolderPort } from '../features/projects/service-deps'

/**
 * What Claude Code keeps about a folder by its PATH, for a project that moves (`relocate.ts`):
 * its trust is READ (Localix never writes it) and its auto memory is copied. Wired here so the
 * projects feature imports neither plugins nor memory, which both read projects.
 */
export function claudeCodeFolderPort(homeDir: string = claudeCodeHome()): ClaudeCodeFolderPort {
  return {
    trusts: (cwd) => claudeCodeTrusts({ homeDir, cwd }),
    carryMemory: (from, to) => carryAutoMemory({ from, to, homeDir }),
  }
}
