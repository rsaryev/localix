import { platformCapabilities } from './platformCapabilities'
import { isDesktop } from '@localixai/kit/environment'

/**
 * Native folder / file pickers, through the desktop shell's own dialog.
 *
 * This used to POST `/desktop/pick-folder` — a fetch-intercept bridge belonging to
 * the ELECTROBUN shell, which was deleted when Tauri replaced it. Nothing serves
 * that route now, so every "Open Folder" spent a round-trip earning a 404 before
 * falling through, and the cancel semantics the old comment promised (a user
 * cancel must not cascade into a second dialog) were never actually in force.
 *
 * The fallback it fell through to is the API's REST picker, which shells out
 * per-platform: `osascript` on macOS, `powershell` on Windows, `zenity` then
 * `kdialog` on Linux. That is both the per-OS hardcoding this app avoids and,
 * on Linux, unreliable — neither zenity nor kdialog is guaranteed installed, so
 * on a minimal desktop the picker silently returned nothing.
 *
 * `tauri-plugin-dialog` reaches the real native dialog on every target Tauri
 * supports, with no external binary. The REST picker stays the BROWSER path,
 * where there is no shell to ask.
 *
 * Returns:
 * - `{ path }`        — the user picked a folder;
 * - `{ path: null }`  — the user CANCELLED (callers must not fall back to
 *                       another picker — that would open a second dialog);
 * - `undefined`       — no desktop shell (plain browser) → use the REST picker.
 */
export async function desktopPickFolder(): Promise<{ path: string | null } | undefined> {
  if (!isDesktop) return undefined
  const invoked = platformCapabilities().desktop.invoke<string | null>('pick_directory')
  if (!invoked) return undefined
  try {
    const path = await invoked
    return { path: typeof path === 'string' && path ? path : null }
  } catch {
    // An older shell without the command, or a dialog the OS refused. Let the
    // caller fall back rather than leaving the user with no picker at all.
    return undefined
  }
}

/**
 * Multi-file counterpart of {@link desktopPickFolder}; an empty list is a cancel.
 *
 * `extensions` (lower-case, no dot) preselects the native dialog's filter. It is a
 * convenience, not a guarantee — an older shell without the argument ignores it,
 * the browser fallback has no filter at all, and the "All files" entry stays
 * reachable — so callers still validate the returned paths.
 */
export async function desktopPickFiles(options?: {
  extensions?: readonly string[]
}): Promise<{ paths: string[] } | undefined> {
  if (!isDesktop) return undefined
  const extensions = options?.extensions?.length ? [...options.extensions] : undefined
  const invoked = platformCapabilities().desktop.invoke<string[]>('pick_files', { extensions })
  if (!invoked) return undefined
  try {
    const paths = await invoked
    return { paths: Array.isArray(paths) ? paths.filter((p) => typeof p === 'string') : [] }
  } catch {
    return undefined
  }
}
