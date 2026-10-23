// The ambient declarations travel WITH the module that needs them. A mini app workspace compiles
// this file through its import graph and never sees `apps/ui`'s own includes, so without the
// reference its type-check failed on the untyped inline-edit registry import below. An `import`
// cannot carry it: the file holds only ambient `declare module` blocks and is not a module.
// oxlint-disable-next-line typescript/triple-slash-reference -- ambient declarations, see above.
/// <reference path="./monaco-esm.d.ts" />
import * as monaco from 'monaco-editor/editor/editor.api.js'
import 'monaco-editor/features/register.all.js'
// oxlint-disable-next-line import/default -- Vite's ?worker loader exposes the constructor as a runtime default export.
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker'
// oxlint-disable-next-line import/default -- Vite's ?worker loader exposes the constructor as a runtime default export.
import JsonWorker from 'monaco-editor/languages/features/json/json.worker.js?worker'

// Load only the grammars Localix exposes. Project-aware semantics come from the
// backend LSP; these contributions provide tokenization and language configuration.
import 'monaco-editor/languages/definitions/typescript/register.js'
import 'monaco-editor/languages/definitions/javascript/register.js'
import 'monaco-editor/languages/features/json/register.js'
import 'monaco-editor/languages/definitions/html/register.js'
import 'monaco-editor/languages/definitions/xml/register.js'
import 'monaco-editor/languages/definitions/css/register.js'
import 'monaco-editor/languages/definitions/scss/register.js'
import 'monaco-editor/languages/definitions/python/register.js'
import 'monaco-editor/languages/definitions/markdown/register.js'
import 'monaco-editor/languages/definitions/rust/register.js'
import 'monaco-editor/languages/definitions/go/register.js'
import 'monaco-editor/languages/definitions/cpp/register.js'
import 'monaco-editor/languages/definitions/java/register.js'
import 'monaco-editor/languages/definitions/ruby/register.js'
import 'monaco-editor/languages/definitions/shell/register.js'
import 'monaco-editor/languages/definitions/dockerfile/register.js'
import 'monaco-editor/languages/definitions/yaml/register.js'
import 'monaco-editor/languages/definitions/sql/register.js'
import 'monaco-editor/languages/definitions/ini/register.js'

import { TriggerInlineEditCommandsRegistry } from 'monaco-editor/editor/browser/triggerInlineEditCommandsRegistry.js'

// Monaco re-asks for an inline suggestion after typing, paste, Backspace/Delete and a
// fixed list of commands — which leaves out deleting a whole word or line and Cut. So
// Opt+Backspace over `Authorize,` left the line waiting at `: ` with nothing ever asked
// for. Registered before any editor exists: each editor's controller reads this list once.
for (const commandId of [
  'deleteWordLeft',
  'deleteWordRight',
  'deleteWordStartLeft',
  'deleteWordEndLeft',
  'deleteWordStartRight',
  'deleteWordEndRight',
  'deleteInsideWord',
  'editor.action.clipboardCutAction',
]) {
  TriggerInlineEditCommandsRegistry.registerCommand(commandId)
}

interface MonacoEnvironmentShape {
  getWorker(_: string, label: string): Worker
}

// All project-aware language features are registered against the live editor model
// by providers.ts. The generic editor worker only handles editor-core background work.
const environment: MonacoEnvironmentShape = {
  getWorker(_moduleId, label) {
    if (label === 'json') return new JsonWorker()
    return new EditorWorker()
  },
}

;(
  globalThis as typeof globalThis & { MonacoEnvironment?: MonacoEnvironmentShape }
).MonacoEnvironment = environment

export { monaco }
