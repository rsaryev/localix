import { scanSavedWorkflows } from '@rsaryev/llx-plugin/agents'
import type { WorkflowEntry } from '../../../agent-core/tools/workflow/workflow'
import { claudeConfigDir } from '../../../cc-settings/config-dir'
import { diskFolderScan } from '../ports/folder-scan'

/**
 * The workflows kept in folders, as the kit finds them (`scanSavedWorkflows`; workflows.md, "Save
 * the workflow for reuse"): `.claude/workflows` of the working directory and every parent up to
 * the repository root, closest first, then `workflows` in the user's Claude folder. A name found in
 * a closer place wins; each runs as `/<meta.name>`, listed with its `meta.description`.
 */
export async function savedWorkflows(opts: {
  cwd: string
  homeDir: string
}): Promise<WorkflowEntry[]> {
  const scan = await scanSavedWorkflows(diskFolderScan({ managedDirectory: undefined }), {
    home: opts.homeDir,
    cwd: opts.cwd,
    configDir: claudeConfigDir(opts.homeDir),
  })
  return scan.winners.map((found) => ({
    fullName: found.name,
    description: found.description ?? '',
    file: found.path,
  }))
}
