import { basename, relative as relativePath } from 'node:path'
import type { MiniAppHostServices } from '@localixai/mini-app-sdk/backend'

import type { GitRepoProject, ResourceGitService } from './source-control/resource-provider'
import { createGitBackend } from './source-control/git/backend'
import { getBranchDiff, getStagedDiff, getUnstagedDiff } from './source-control/git/scope-diff'
import { discoverRepos } from './source-control/repos/discovery'

type WorkspaceHost = NonNullable<MiniAppHostServices['workspaces']>

export function createGitResourceService(workspaces: WorkspaceHost): ResourceGitService {
  const backend = createGitBackend()
  const listRepos = async (containerCwd: string) => {
    const roots = await discoverRepos(containerCwd).catch(() => [] as string[])
    return roots.map((root) => {
      const relpath = relativePath(containerCwd, root)
      return { relpath, name: relpath === '' ? 'root' : basename(root), cwd: root }
    })
  }

  return {
    listRepoProjects: async (userId) => {
      const projects = await workspaces.listProjects(userId)
      const checked = await Promise.all(
        projects.map(async (project): Promise<GitRepoProject | null> => {
          const cwd = project.workingDirectory
          if (!cwd) return null
          const repos = await listRepos(cwd)
          if (repos.length === 0) return null
          const single = repos.length === 1 && repos[0]!.relpath === ''
          const branch = single
            ? await backend
                .getStatus(cwd)
                .then((status) => status.branch)
                .catch(() => null)
            : null
          return { id: project.id, name: project.name, cwd, branch }
        }),
      )
      return checked.filter((project): project is GitRepoProject => project !== null)
    },
    resolveRepoCwd: (userId, projectId) => workspaces.resolveProjectDirectory(userId, projectId),
    listRepos,
    listBranches: (cwd) => backend.listBranches(cwd),
    getStatus: (cwd) => backend.getStatus(cwd),
    getLog: (cwd, limit) => backend.getLog(cwd, limit),
    getCommitShow: (cwd, sha) => backend.getCommitShow(cwd, sha),
    getCommitFiles: (cwd, sha) => backend.getCommitFiles(cwd, sha),
    getCommitFileDiff: (cwd, sha, path) => backend.getCommitFileDiff(cwd, sha, path),
    getWorkingDiff: (cwd) => backend.getCommitDiff(cwd),
    getStagedDiff,
    getUnstagedDiff,
    getBranchDiff,
  }
}
