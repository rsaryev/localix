/**
 * THE RUNTIME of a mod instance's VM: the code the VM runs before the hooks module, bundled for
 * QuickJS (`guest-file.ts`) and handed to the VM by the host (`mod-vm.ts`). It speaks the channel
 * (`endpoint.ts`) over JSON text through `host`, the VM's only way out; gives the module its world
 * — `console`, `AbortController` and the other web APIs QuickJS lacks, `h` and `Fragment`, the
 * `claude-code` runtime — before the VM freezes every built-in; and from then on loads the module
 * and runs the hooks the host calls (`hooks.ts`), each `$` call and `next` going back to the host
 * (`dollar.ts`).
 */
import { Fragment, h } from '@localixai/claude-plugin/mods'
import type { CallInput } from '../call-protocol'
import { createEndpoint, type Handler } from '../endpoint'
import { createGuestConsole } from './console'
import { createGuestApi } from './dollar'
import { createGuestHooks } from './hooks'
import { installWebApis } from './web'

/** What the VM lends its runtime (`@localixai/engine-scripts`, `worker-vm.ts`). */
declare const host: {
  post(json: string): void
  listen(receive: (json: string) => void): void
  evaluate(source: string, name: string): unknown
}

const global = globalThis as unknown as Record<PropertyKey, unknown>

const endpoint = createEndpoint({
  post: (message) => host.post(JSON.stringify(message)),
  handlers: {
    load: (({ code, name, options }: { code: unknown; name: unknown; options: unknown }) =>
      hooks.load(code, name, options)) as Handler,
    call: ((input: CallInput) => hooks.call(input)) as Handler,
    step: (({ id }: { id: number }) => hooks.step(id)) as Handler,
    end: (({ id }: { id: number }) => hooks.end(id)) as Handler,
    abort: (({ call }: { call: number }) => api.abort(call)) as Handler,
    tables: (({ tables }: { tables: Record<string, Record<string, unknown>> }) =>
      api.setTables(tables)) as Handler,
  },
})
const api = createGuestApi(endpoint)
const hooks = createGuestHooks({
  api,
  evaluate: (source, name) => host.evaluate(source, name),
})

installWebApis(global)
global.console = createGuestConsole({
  print: (level, line) => endpoint.notify('console', { level, line }),
  now: () => Date.now(),
})
global[Symbol.for('localix.mods.claude-code')] = Object.freeze({ h, Fragment })

host.listen((json) => endpoint.receive(JSON.parse(json)))
