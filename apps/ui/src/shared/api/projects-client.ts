/**
 * Projects — the CRUD surface, the composer's @-ref expansion, and the native file/folder
 * pickers. One of the `backendClient` domain modules spread into the facade in `./client`,
 * so `backendClient.listProjects()` keeps working unchanged.
 */

import { client, unwrap, assertOk } from './internal'
import { desktopPickFiles, desktopPickFolder } from '@/shared/lib/desktopDialogs'
import type {
  Project,
  ProjectSettingsPatch,
  UpdateProjectRequest,
  ResolveProjectByPathResponse,
  ExpandRefsRequest,
  ExpandRefsResponse,
} from './contracts'

export const projectsApi = {
  async listProjects(signal?: AbortSignal): Promise<Project[]> {
    const json = await unwrap(await client.rpc.projects.$get(undefined, { init: { signal } }))
    return json.projects
  },

  async createProject(name: string, workingDir: string): Promise<Project> {
    return unwrap(await client.rpc.projects.$post({ json: { name, workingDir } }))
  },

  /**
   * Find-or-create a project for a filesystem path — backs `localix .` / `localix <path>`.
   * A directory resolves the project directly; a file resolves the project from its parent
   * dir and returns `filePath` so the caller opens an editor tab.
   */
  async resolveProjectByPath(path: string): Promise<ResolveProjectByPathResponse> {
    return unwrap(await client.rpc.projects['resolve-path'].$post({ json: { path } }))
  },

  /**
   * Classify a filesystem path as a file or a directory without creating anything. An OS open uses
   * it: a file opens in the chat on screen, only a directory goes on to `resolveProjectByPath`.
   */
  async inspectPath(path: string) {
    return unwrap(await client.rpc.projects['inspect-path'].$post({ json: { path } }))
  },

  async updateProject(id: string, patch: UpdateProjectRequest): Promise<Project> {
    return unwrap(
      await client.rpc.projects[':id'].$patch({
        param: { id },
        json: patch,
      }),
    )
  },

  async patchProjectSettings(id: string, settingsPatch: ProjectSettingsPatch): Promise<Project> {
    return unwrap(
      await client.rpc.projects[':id'].$patch({
        param: { id },
        json: { settingsPatch },
      }),
    )
  },

  async deleteProject(id: string): Promise<void> {
    await assertOk(await client.rpc.projects[':id'].$delete({ param: { id } }))
  },

  /** Expand composer @-refs (every ref-kind registry kind) server-side; workdir-free kinds
   *  (session/terminal/call/task) resolve via their loaders. */
  async expandContextRefs(input: ExpandRefsRequest): Promise<ExpandRefsResponse> {
    return unwrap(await client.rpc.projects['expand-refs'].$post({ json: input }))
  },

  /**
   * Native folder chooser. In the desktop shell this is the shell's OWN dialog
   * (`tauri-plugin-dialog`): a `{ path: null }` there is a user CANCEL and must not
   * cascade into a second dialog. Only with no shell at all (a plain browser) does it
   * fall back to the API's per-platform REST picker (osascript / PowerShell / zenity),
   * which is also the only place that per-OS shelling still lives.
   */
  async pickDirectory(): Promise<string | null> {
    const picked = await desktopPickFolder()
    if (picked) return picked.path
    const json = await unwrap(await client.rpc.projects['pick-dir'].$post())
    return json.path
  },

  /** `options.extensions` filters the DESKTOP dialog only; the browser REST picker
   *  has no filter to set, so callers validate the result either way. */
  async pickFiles(options?: { extensions?: readonly string[] }): Promise<string[]> {
    const picked = await desktopPickFiles(options)
    if (picked) return picked.paths
    const json = await unwrap(await client.rpc.projects['pick-files'].$post())
    return json.paths
  },

  async openProjectDirectory(id: string): Promise<void> {
    await unwrap(await client.rpc.projects[':id'].open.$post({ param: { id } }))
  },
}
