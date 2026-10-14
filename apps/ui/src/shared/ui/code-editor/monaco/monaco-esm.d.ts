declare module 'monaco-editor/features/register.all.js'

declare module 'monaco-editor/editor/browser/triggerInlineEditCommandsRegistry.js' {
  export const TriggerInlineEditCommandsRegistry: {
    registerCommand(commandId: string): void
    getRegisteredCommands(): string[]
  }
}

declare module 'monaco-editor/editor/editor.worker.js?worker' {
  const EditorWorker: new () => Worker
  export default EditorWorker
}

declare module 'monaco-editor/languages/features/json/json.worker.js?worker' {
  const JsonWorker: new () => Worker
  export default JsonWorker
}
