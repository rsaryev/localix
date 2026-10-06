import path from 'node:path'
import type { Plugin } from 'vite'

/** A changed shared-module catalog needs a fresh page: the installed registry is a singleton. */
export function refreshPluginSharedModules(): Plugin {
  return {
    name: 'localix:refresh-plugin-shared-modules',
    apply: 'serve',
    configureServer(server) {
      const registry = path.resolve(server.config.root, 'src/app/pluginSharedModules.ts')
      const directories = [
        path.resolve(server.config.root, '../../packages/kit/src/entries'),
        path.resolve(server.config.root, 'src/app/kit'),
      ]
      // The package doors are outside Vite's app root. A new file can otherwise leave its glob
      // transform cached even while a rebuilt plugin already imports that new module.
      server.watcher.add(directories)
      const refresh = (file: string) => {
        if (!file.endsWith('.ts') || !directories.includes(path.dirname(path.resolve(file)))) return
        const graph = server.environments.client.moduleGraph
        const modules = graph.getModulesByFile(registry)
        if (!modules?.size) return
        for (const module of modules) graph.invalidateModule(module)
        // Updating the glob alone leaves the old registry on globalThis, and already evaluated
        // plugin shims keep its exports. Reload both sides of that contract together.
        server.ws.send({ type: 'full-reload' })
      }
      server.watcher.on('add', refresh)
      server.watcher.on('unlink', refresh)
      server.httpServer?.once('close', () => {
        server.watcher.off('add', refresh)
        server.watcher.off('unlink', refresh)
      })
    },
  }
}
