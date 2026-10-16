import { expect, spyOn, test } from 'bun:test'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import * as binaries from './lsp-bin-resolve'
import { HtmlServer, JsonServer, CssServer, DockerServer, YamlServer } from './lsp-servers'

const servers = [
  [HtmlServer, 'html-languageserver'],
  [JsonServer, 'vscode-json-language-server'],
  [CssServer, 'vscode-css-language-server'],
  [DockerServer, 'docker-langserver'],
  [YamlServer, 'yaml-language-server'],
] as const

for (const [server, name] of servers) {
  for (const source of ['root', 'project', 'path', 'missing', 'spawn-failed'] as const) {
    test(`${server.id} preserves lookup precedence and spawn results (${source})`, async () => {
      const calls: unknown[] = []
      const process = {} as ChildProcessWithoutNullStreams
      const npm = spyOn(binaries, 'resolveNpmBin').mockImplementation((bin, root) => {
        calls.push(['npm', bin, root])
        if (source === 'root' || source === 'spawn-failed') return '/bin/root'
        if (source === 'project' && root === '/project') return '/bin/project'
        return undefined
      })
      const which = spyOn(binaries, 'which').mockImplementation((bin) => {
        calls.push(['path', bin])
        return source === 'path' ? '/bin/path' : undefined
      })
      const spawn = spyOn(binaries, 'spawnJsServer').mockImplementation((bin, args, root) => {
        calls.push(['spawn', bin, args, root])
        return source === 'spawn-failed' ? undefined : process
      })
      try {
        const result = await server.spawn('/root', '/project')
        const expected: unknown[] = [['npm', name, '/root']]
        if (source !== 'root' && source !== 'spawn-failed') expected.push(['npm', name, '/project'])
        if (source === 'path' || source === 'missing') expected.push(['path', name])
        if (source !== 'missing')
          expected.push([
            'spawn',
            `/bin/${source === 'spawn-failed' ? 'root' : source}`,
            ['--stdio'],
            '/root',
          ])
        expect(calls).toEqual(expected)
        if (source === 'missing' || source === 'spawn-failed') expect(result).toBeUndefined()
        else {
          expect(result?.process).toBe(process)
          expect(result?.initialization).toEqual({})
        }
      } finally {
        npm.mockRestore()
        which.mockRestore()
        spawn.mockRestore()
      }
    })
  }
}
