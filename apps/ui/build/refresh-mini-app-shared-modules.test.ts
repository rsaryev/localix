import { expect, spyOn, test } from 'bun:test'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer } from 'vite'
import { refreshMiniAppSharedModules } from './refresh-mini-app-shared-modules'

test('refreshes the host glob and the page when a shared module is added or removed', async () => {
  const repo = await realpath(await mkdtemp(path.join(tmpdir(), 'localix-shared-modules-')))
  const root = path.join(repo, 'apps/ui')
  const doors = path.join(repo, 'packages/kit/src/entries')
  const lent = path.join(root, 'src/app/kit')
  await mkdir(doors, { recursive: true })
  await mkdir(lent, { recursive: true })
  await writeFile(path.join(doors, 'existing.ts'), 'export const Existing = true')
  await writeFile(
    path.join(root, 'src/app/miniAppSharedModules.ts'),
    'export const modules = import.meta.glob("../../../../packages/kit/src/entries/*.ts")',
  )
  const server = await createServer({
    configFile: false,
    root,
    plugins: [refreshMiniAppSharedModules()],
    server: { middlewareMode: true, fs: { allow: [repo] } },
  })
  const messages: unknown[] = []
  const send = spyOn(server.ws, 'send').mockImplementation((message) => {
    messages.push(message)
  })
  try {
    const url = '/src/app/miniAppSharedModules.ts'
    expect((await server.transformRequest(url))?.code).not.toContain('coding-agent-marks.ts')
    const added = path.join(doors, 'coding-agent-marks.ts')
    await writeFile(added, 'export const ClaudeMark = true')
    server.watcher.emit('add', added)
    expect(messages).toContainEqual({ type: 'full-reload' })
    expect((await server.transformRequest(url))?.code).toContain('coding-agent-marks.ts')

    messages.length = 0
    await rm(added)
    server.watcher.emit('unlink', added)
    expect(messages).toContainEqual({ type: 'full-reload' })
    expect((await server.transformRequest(url))?.code).not.toContain('coding-agent-marks.ts')

    messages.length = 0
    const hostModule = path.join(lent, 'fixture.ts')
    server.watcher.emit('add', hostModule)
    expect(messages).toContainEqual({ type: 'full-reload' })

    messages.length = 0
    server.watcher.emit('add', path.join(doors, 'example.test.tsx'))
    server.watcher.emit('add', path.join(root, 'src/app/elsewhere.ts'))
    server.watcher.emit('change', path.join(doors, 'existing.ts'))
    expect(messages).toEqual([])
  } finally {
    send.mockRestore()
    await server.close()
    await rm(repo, { recursive: true, force: true })
  }
}, 20_000)
