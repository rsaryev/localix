// The UI's API contract barrel. Each domain lives in `./contracts/*`; this file only
// re-exports them so every existing `shared/api/contracts` import keeps resolving here.
export * from './contracts/wire'
export * from './contracts/hitl'
export * from './contracts/message'
export * from './contracts/capabilities'

// The store's session record lives in its own module
// (`ui-session.ts`): the largest shape in this contract, and the one that grows with every
// strip above the composer. Re-exported so every existing import keeps resolving here.
export type { UiSession } from './ui-session'

export { sessionRef } from '@localixai/api/session-ref'
export type { ResourceBrowseResult, ResourceNode, ResourceNodeAction } from '@localixai/api/client'
