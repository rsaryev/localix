import { defineConfig, type PluginOption } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'
import path from 'node:path'
import { resolveBuildStamp } from '../../scripts/build-stamp.mjs'
import { failOnNodeBuiltin } from './build/fail-on-node-builtin'
import { refreshMiniAppSharedModules } from './build/refresh-mini-app-shared-modules'

// No THIRD_PARTY_NOTICES here: this dist is only ever the desktop app's embedded frontend, and
// the app already carries the same notices (the same `stageThirdPartyNotices` call) in its
// resources, staged by `apps/desktop-tauri/scripts/prepare-sidecar.mjs`. Writing them into the
// frontend too shipped every notice twice, once of them compiled into the executable.

// https://vite.dev/config/
export default defineConfig(({ command }) => {
  const apiTarget = process.env.VITE_API_BASE_URL?.replace(/\/$/, '')
  if (command === 'serve' && !apiTarget) {
    throw new Error('VITE_API_BASE_URL is required. Start development through `bun run dev`.')
  }
  return {
    define: {
      // Identity of the bundle in the startup log. A commit or a cache key, never a timestamp:
      // a timestamp would change every emitted bundle and defeat the build cache. Resolved
      // only for `build` — a dev server is served live, so it cannot be stale.
      // `scripts/build-stamp.mjs` owns the rule for desktop staging and this build alike.
      __UI_BUILD__: JSON.stringify(command === 'build' ? resolveBuildStamp() : 'dev'),
    },
    server: {
      // `LOCALIX_DEV_UI_PORT` is read HERE and not only in the launcher's preflight:
      // the two disagreed, so setting the variable moved the availability CHECK while
      // Vite stayed nailed to 5050 — a knob that reported success and changed nothing.
      // Kept in sync with `FRONTEND_DEV_PORT` in `scripts/dev-servers.mjs`.
      port: Number(process.env.LOCALIX_DEV_UI_PORT || 5050),
      // 5051 is the Localix API. Vite's default "try the next port" behavior
      // silently moved a second frontend onto the backend port and produced a
      // convincing but half-working app. A dev launch is one fixed port pair:
      // fail immediately when the frontend port is occupied.
      strictPort: true,
      // Bind all interfaces only when asked (e.g. inside the dev container, which
      // sets VITE_DEV_HOST=0.0.0.0 so the mapped port is reachable from the host).
      // Unset on a normal host → Vite's default localhost-only binding.
      host: process.env.VITE_DEV_HOST || undefined,
      fs: {
        // Workspace packages (`packages/*`, `vendor/*`) resolve to real paths OUTSIDE this
        // Vite root (apps/ui); allow the monorepo root so they load in dev. Mini apps are not
        // among them: a mini app's UI is a built artifact the API serves, never host source.
        allow: [path.resolve(__dirname, '../..')],
      },
      proxy: {
        '/rpc': {
          target: apiTarget!,
          changeOrigin: true,
          // NOTE: WebSocket upgrades are NOT proxied here. Under `bun run dev`,
          // Vite's bundled proxy (http-proxy) can't relay a WS upgrade — Bun lacks
          // `Socket#destroySoon`, which http-proxy calls on teardown, crashing the
          // dev server. So the browser connects /rpc/ws + /rpc/terminal/:id/stream
          // straight to the API instead (see WS_BASE_URL in shared/api/internal.ts).
          // `ws: true` is left off deliberately; REST still proxies fine.
          ws: false,
          // Long-lived connections must not be closed by the proxy on inactivity.
          // proxyTimeout: 0 keeps the tunnel open; Bun's WebSocket pings keep
          // /rpc/ws healthy regardless.
          proxyTimeout: 0,
          timeout: 0,
        },
        '/desktop': {
          target: apiTarget!,
          changeOrigin: true,
          proxyTimeout: 0,
          timeout: 0,
        },
      },
    },
    plugins: [
      // Refuses a server-only module that reached the browser graph, at the import, naming the
      // file that pulled it in — before Vite can externalize it into a stub that throws at
      // render. See `build/fail-on-node-builtin.ts`. Measured: no effect on build time (17.4-17.7s
      // either way); the profiler reports it as 95% of one phase because it is the only plugin
      // resolving in that phase, not because the phase is expensive.
      failOnNodeBuiltin(),
      refreshMiniAppSharedModules(),
      nodePolyfills({ include: ['events', 'process', 'buffer'] }),
      react(),
      // React Compiler only in production builds. In dev it injects a per-component
      // hook cache (useMemoCache), and a Fast Refresh hot-patch can change the slot
      // count between renders → React throws "rendered fewer hooks than expected"
      // mid-render, unmounting the whole tree (black screen, only a full reload
      // recovers). Dev runs plain Fast Refresh (stable); prod keeps the compiler.
      // A falsy entry is dropped by Vite, so this stays ordered after react().
      command === 'build' ? babel({ presets: [reactCompilerPreset()] }) : null,
      tailwindcss(),
    ] as PluginOption[],
    resolve: {
      // Ensure a single React copy across the monorepo so hooks from
      // react-router-dom share the same renderer instance.
      //
      dedupe: ['react', 'react-dom', 'react-router-dom'],
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    optimizeDeps: { include: ['react', 'react-dom', 'react-router-dom'] },
    build: {
      // `rolldownOptions`, not `rollupOptions`: Vite 8 deprecated the latter, and
      // it silently ignores `output.codeSplitting` — the build's own warning names
      // this key.
      rolldownOptions: {
        // Silence Rolldown's INVALID_ANNOTATION spam: third-party deps (e.g.
        // @hugeicons/core-free-icons) put `/*#__PURE__*/` in a position Rolldown
        // can't interpret. It's their code, not ours, and only affects tree-shaking
        // hinting — so drop just that code and let every other warning through.
        onwarn(warning, defaultHandler) {
          if (warning.code === 'INVALID_ANNOTATION') return
          defaultHandler(warning)
        },
        output: {
          // Checkbox and Switch are part of the startup shell and share Field's
          // accessible label/help/error context. Keep this deliberately tiny form
          // core in one request instead of making startup fetch one chunk per
          // control. This exact set cannot pull a lazy workbench surface into the
          // entry graph; do not replace it with a broad min-size rule.
          codeSplitting: {
            groups: [
              {
                // Startup icons, one request instead of ~100.
                //
                // Every lucide icon is its own leaf module, so an icon used by both
                // the shell and some lazy surface gets split into its own sub-1KB
                // chunk that `index.html` then preloads. That is a hundred requests
                // for ~35 kB of glyphs, and it is the single largest contributor to
                // the startup FILE count the budget ratchets.
                //
                // `tags: ['$initial']` is what makes this safe and NOT the broad
                // merge warned about below: it captures only modules already
                // statically reachable from the entry. An icon used solely by a lazy
                // chunk is not `$initial`, so it stays in that chunk instead of being
                // hoisted onto the startup path — the merge moves no bytes forward,
                // it only stops fragmenting bytes startup already pays for.
                name: 'startup-icons',
                tags: ['$initial'],
                includeDependenciesRecursively: false,
                test(id) {
                  return id.replaceAll('\\', '/').includes('/lucide-react/dist/esm/icons/')
                },
              },
              {
                // The kit's startup primitives, one request instead of ~20.
                //
                // Moving the primitives into `packages/kit` put a door module
                // (`src/entries/<id>.ts`) between every consumer and its primitive, and a
                // primitive used by the shell AND a lazy surface became a sub-2KB shared chunk
                // of its own: +11 startup files and +19 kB of chunk wrapping, over the byte
                // budget. Same rule as the icons above — `$initial` only, so a primitive only a
                // lazy surface uses stays with that surface and no byte moves onto startup.
                name: 'startup-kit',
                tags: ['$initial'],
                includeDependenciesRecursively: false,
                test(id) {
                  return id.replaceAll('\\', '/').includes('/packages/kit/src/')
                },
              },
              {
                name: 'form-core',
                includeDependenciesRecursively: false,
                test(id) {
                  const moduleId = id.replaceAll('\\', '/')
                  return (
                    moduleId.endsWith('/packages/kit/src/controls/checkbox.tsx') ||
                    moduleId.endsWith('/packages/kit/src/controls/field.tsx') ||
                    moduleId.endsWith('/packages/kit/src/controls/switch.tsx')
                  )
                },
              },
            ],
          },
          // Keep Monaco in the dynamic CodeEditor graph. Forcing it into a manual
          // vendor chunk can pull shared runtime modules into that chunk, which in
          // turn makes index.html preload the editor before any editor is opened.
          //
          // Do not merge this graph by chunk count alone. Packaged-app measurement
          // showed local delivery overhead is small, while a broad `minSize` can
          // pull a lazy editor or workbench surface back into index.html. Reduce
          // startup by moving uncommon static dependencies behind real import()
          // boundaries instead. `check-ui-startup-budget.mjs` ratchets the emitted
          // index graph by both total bytes and file count after every UI build.
        },
      },
    },
  }
})
