import { describe, expect, test } from 'bun:test'
import { createSourceControlService } from './service'
import { GIT_PREREQUISITE } from './git-prerequisite'

/**
 * Detection runs `git`, so a machine WITHOUT git answers exactly like a directory that is not a
 * repository — and the panel said "Not a git repository", false about the directory and with no
 * way out. The status names the missing program instead.
 */
function serviceWith(gitInstalled: boolean) {
  return createSourceControlService({
    resolveCwd: async () => '/work/project',
    resolveBackend: async () => null,
    gitInstalled: () => gitInstalled,
  })
}

describe('getStatus without a repository', () => {
  test('no git on the machine: the status carries the Git prerequisite', async () => {
    const status = await serviceWith(false).getStatus('u', 's')
    expect(status.isRepo).toBe(false)
    expect(status.prerequisite).toEqual(GIT_PREREQUISITE)
    expect(status.prerequisite?.installUrl).toStartWith('https://')
  })

  test('git installed: an ordinary "not a repository", no prerequisite', async () => {
    const status = await serviceWith(true).getStatus('u', 's')
    expect(status.isRepo).toBe(false)
    expect(status.prerequisite).toBeUndefined()
  })
})
