/**
 * THE ORGANIZATION'S LOCK ON WHERE SKILLS MAY COME FROM (`strictPluginOnlyCustomization`,
 * settings-reference.md). The core reads skill folders; what a lock means is the host's to read
 * from Claude Code's managed settings, so the host installs it here (A4: the composition root wires
 * it) and the one discovery every caller shares applies it:
 *
 *   - `skills` locked: nothing from the person's or a project's skill and command folders loads;
 *   - `hooks` locked: the `hooks` of a skill that still loads from those folders do not run, and
 *     such a skill loses its `allowed-tools` pre-approval unless it runs forked
 *     (settings-reference.md, `strictPluginOnlyCustomization.hooks`).
 *
 * A plugin's skills and the managed policy folder are not read through this discovery.
 */
export interface SkillSourceLock {
  /** Skip every skill of the person's and the project's folders. */
  blockFolders: boolean
  /** Drop the `hooks` of a skill read from those folders (and its pre-approval). */
  stripHooks: boolean
}

export type SkillSourcePolicy = (query: {
  workingDir: string | null
  homeDir: string
}) => Promise<SkillSourceLock>

let installed: SkillSourcePolicy | undefined

/** Install (or, with `undefined`, remove) the host's policy. One per process, set at boot. */
export function installSkillSourcePolicy(policy: SkillSourcePolicy | undefined): void {
  installed = policy
}

export async function skillSourceLock(query: {
  workingDir: string | null
  homeDir: string
}): Promise<SkillSourceLock> {
  return (await installed?.(query)) ?? { blockFolders: false, stripHooks: false }
}
