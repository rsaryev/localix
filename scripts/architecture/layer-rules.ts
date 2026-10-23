import { importsOf, resolveSpec, type Rule } from './kit'

/**
 * X1 (`docs/internals/plugins-and-mini-apps.md`): plugins and mini apps share no code. The
 * plugins feature and the Claude Code format package never import the mini app feature or SDK,
 * and the mini app feature and SDK never import the plugin side. Type imports count: a type is
 * knowledge of the other layer too. A consumer of both (the chat runtime, bootstrap) is free to.
 */
const SIDES = [
  {
    side: 'plugin',
    owns: ['apps/api/src/features/plugins/', 'packages/claude-plugin/'],
    files: ['apps/api/src/features/mini-apps/', 'packages/mini-app-sdk/'],
    packages: ['@localixai/mini-app-sdk', '@localix-mini-app/'],
  },
  {
    side: 'mini app',
    owns: ['apps/api/src/features/mini-apps/', 'packages/mini-app-sdk/'],
    files: ['apps/api/src/features/plugins/', 'packages/claude-plugin/'],
    packages: ['@localixai/claude-plugin'],
  },
] as const

export const X1_LAYERS_APART: Rule = {
  id: 'X1',
  fix: 'move what both need into a neutral lib, or let a consumer of both (bootstrap, chat) join them',
  detect(sources) {
    const found = new Set<string>()
    for (const source of sources) {
      const side = SIDES.find((entry) => entry.owns.some((root) => source.file.startsWith(root)))
      if (!side) continue
      for (const ref of importsOf(source)) {
        const target = resolveSpec(source.file, ref.spec)
        const crosses =
          (target !== null && side.files.some((root) => target.startsWith(root))) ||
          side.packages.some((name) => ref.spec === name || ref.spec.startsWith(`${name}/`))
        const other = side.packages.find((name) => ref.spec.startsWith(name))
        if (crosses)
          found.add(
            `${source.file} imports the ${side.side === 'plugin' ? 'mini app' : 'plugin'} side (${other ?? target})`,
          )
      }
    }
    return [...found]
  },
}
