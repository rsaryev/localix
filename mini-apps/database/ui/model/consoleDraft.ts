/**
 * localStorage key for a console's persisted editor draft. A zero-dep leaf so the
 * eagerly-mounted close-time cleanup (`useConsoleDraftCleanup`) can share it with
 * `useSqlConsole` without pulling the whole console model graph into the entry chunk.
 */
export const draftStoreKey = (key: string) => `db.console.draft.${key}`
