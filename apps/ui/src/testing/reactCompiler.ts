import { transformAsync } from '@babel/core'

/**
 * Load the modules `filter` matches through the React Compiler, as `vite build` does: the dev server
 * and the other tests run them uncompiled (`vite.config.ts`). The compiler memoizes a value on the
 * inputs it can see, so a render that reads a module store beside a subscription that only
 * re-renders keeps its first answer in the app while it updates in dev and in a plain test.
 *
 * Call it before the modules are first imported, and import them dynamically after it: a static
 * import is loaded before the test file runs.
 */
export function compileLikeTheBuild(filter: RegExp): void {
  Bun.plugin({
    name: `react-compiler ${filter.source}`,
    setup(build) {
      build.onLoad({ filter }, async ({ path }) => {
        const result = await transformAsync(await Bun.file(path).text(), {
          filename: path,
          babelrc: false,
          configFile: false,
          // JSX only where it can be: in a `.ts` file `<T>(…) =>` is a generic, not a tag.
          parserOpts: { plugins: path.endsWith('x') ? ['typescript', 'jsx'] : ['typescript'] },
          plugins: ['babel-plugin-react-compiler'],
        })
        return { contents: result!.code!, loader: path.endsWith('x') ? 'tsx' : 'ts' }
      })
    },
  })
}
