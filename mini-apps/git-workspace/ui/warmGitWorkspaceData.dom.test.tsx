import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { registerDom } from '@localixai/kit/testing'

const turns = async (n = 10) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r))
}

let teardown: () => Promise<void>
beforeAll(() => {
  teardown = registerDom()
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})
afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await teardown()
})

const settle = () => turns()

describe('warm-hidden Source Control data sources', () => {
  test('HEAD, forge, log, and staging reads wait for selection', async () => {
    const React = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { act } = React
    const { sourceControlApi } = await import('./api')
    const { WorkItemVisibilityProvider } = await import('@localixai/mini-app-sdk/ui/visibility')
    const { useGitPanelOps } = await import('./source-control/model/useGitPanelOps')
    const { usePullRequests } = await import('./source-control/model/usePullRequests')
    const { CommitGraph } = await import('./source-control/ui/CommitGraph')
    const { DiffStagingView } = await import('./source-control/ui/DiffStagingView')

    const head = spyOn(sourceControlApi, 'getHeadCommitMessage').mockResolvedValue(null)
    const recent = spyOn(sourceControlApi, 'getRecentCommitMessages').mockResolvedValue([])
    const forge = spyOn(sourceControlApi, 'getForgeStatus').mockResolvedValue({
      installed: true,
      authed: true,
      hasRemote: true,
    } as never)
    const pullRequests = spyOn(sourceControlApi, 'listPullRequests').mockResolvedValue([])
    const log = spyOn(sourceControlApi, 'getLog').mockResolvedValue([])
    const diff = spyOn(sourceControlApi, 'getFileDiffLines').mockResolvedValue({
      lines: [],
    } as never)

    function Hooks() {
      useGitPanelOps('session-1', '/repo')
      usePullRequests('session-1', '/repo', 'main')
      return null
    }
    function Surface({ visible }: { visible: boolean }) {
      return (
        <WorkItemVisibilityProvider visible={visible}>
          <Hooks />
          <CommitGraph sessionId="session-1" />
          <DiffStagingView
            sessionId="session-1"
            path="src/app.ts"
            mode="unstaged"
            repoRoot="/repo"
          />
        </WorkItemVisibilityProvider>
      )
    }

    const root = createRoot(document.createElement('div'))
    await act(async () => {
      root.render(<Surface visible={false} />)
      await settle()
    })
    expect(head).toHaveBeenCalledTimes(0)
    expect(recent).toHaveBeenCalledTimes(0)
    expect(forge).toHaveBeenCalledTimes(0)
    expect(pullRequests).toHaveBeenCalledTimes(0)
    expect(log).toHaveBeenCalledTimes(0)
    expect(diff).toHaveBeenCalledTimes(0)

    await act(async () => {
      root.render(<Surface visible />)
      await settle()
    })
    expect(head).toHaveBeenCalledTimes(1)
    expect(recent).toHaveBeenCalledTimes(1)
    expect(forge).toHaveBeenCalledTimes(1)
    expect(pullRequests).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledTimes(1)
    expect(diff).toHaveBeenCalledTimes(1)

    await act(async () => root.unmount())
    head.mockRestore()
    recent.mockRestore()
    forge.mockRestore()
    pullRequests.mockRestore()
    log.mockRestore()
    diff.mockRestore()
  })
})
