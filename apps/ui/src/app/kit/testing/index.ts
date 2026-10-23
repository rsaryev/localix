// The kit's TEST harness: what a mini app's tests need from the host to exercise a real
// integration — a DOM, and the host buses a mini app reaches through the SDK. Never part of a
// runtime artifact (`isMiniAppUiSharedModule` excludes `@localixai/kit/testing*`); tests resolve
// it to this file through their tsconfig paths.
export { registerDom } from '@localixai/kit/testing/dom'
export { composerBus } from '@/shared/lib/composerBus'
export type { ComposerInsert } from '@/shared/lib/composerBus'
export { registerInspectorHandler } from '@/shared/lib/inspectorBus'
export type { InspectorRequest } from '@/shared/lib/inspectorBus'
export { acceptedDragKind } from '@/entities/chat/ui/prompt-input/dropzoneState'
export { backendClient } from '@/shared/api/client'
