import { expect, spyOn, test } from 'bun:test'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import * as binaries from './lsp-bin-resolve'
import { HtmlServer, JsonServer, CssServer, DockerServer, YamlServer } from './lsp-servers'

const servers = [
  [HtmlServer, 'vscode-html-language-server'],
  [JsonServer, 'vscode-json-language-server'],
  [CssServer, 'vscode-css-language-server'],
  [DockerServer, 'docker-langserver'],
  [YamlServer, 'yaml-language-server'],
] as const

// Lookup precedence (managed install, project, PATH) is resolveNpmBin's and is tested with it.
for (const [server, name] of servers) {
  for (const source of ['found', 'missing', 'spawn-failed'] as const) {
    test(`${server.id} resolves within the project root and spawns the result (${source})`, async () => {
      const calls: unknown[] = []
      const process = {} as ChildProcessWithoutNullStreams
      const npm = spyOn(binaries, 'resolveNpmBin').mockImplementation((bin, root, project, dir) => {
        calls.push(['npm', bin, root, project, dir])
        return source === 'missing' ? undefined : '/bin/server'
      })
      const spawn = spyOn(binaries, 'spawnJsServer').mockImplementation((bin, args, root) => {
        calls.push(['spawn', bin, args, root])
        return source === 'spawn-failed' ? undefined : process
      })
      try {
        const result = await server.spawn('/root', '/project', '/managed')
        const expected: unknown[] = [['npm', name, '/root', '/project', '/managed']]
        if (source !== 'missing') expected.push(['spawn', '/bin/server', ['--stdio'], '/root'])
        expect(calls).toEqual(expected)
        if (source === 'found') {
          expect(result?.process).toBe(process)
          expect(result?.initialization).toEqual({})
        } else expect(result).toBeUndefined()
      } finally {
        npm.mockRestore()
        spawn.mockRestore()
      }
    })
  }
}
