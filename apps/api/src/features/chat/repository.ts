import type { Kysely } from 'kysely'

import type { AppDatabase } from '../../db'
import { createActivatedToolQueries } from './repository-activated-tools'
import { createEmptyDraftQueries } from './repository-empty-draft'
import { createHistoryQueries } from './repository-history'
import { createMessageQueries } from './repository-messages'
import { createRuntimeQueries } from './repository-runtime'
import { createRecentRouteQueries } from './repository-recent-routes'
import { createSessionReadQueries } from './repository-sessions-read'
import { createSessionWriteQueries } from './repository-sessions-write'
import { createSessionTopicQueries } from './repository-session-topic'
import { createSessionLeafOps, createTreeQueries } from './repository-tree'
import { createUsageQueries } from './repository-usage-sync'

// Re-exported from ./repository-mappers (co-located with the other row mappers)
// so existing `import { toSessionSummary } from "../repository"` sites keep working.
export { toSessionSummary } from './repository-mappers'

// Row/record shapes live in ./repository-types; re-exported here so existing
// importers of `SessionRecord` and the History* row types keep their paths.
export type {
  HistorySearchHit,
  HistorySearchHitDetailed,
  HistoryMessageRow,
  RecentSessionRow,
  SessionMetaRow,
  SessionAgentRoute,
  ModelRoute,
  SessionRecord,
} from './repository-types'

/**
 * The chat repository is one facade over per-concern query modules (session reads,
 * session writes, messages, session tree, runtime state, usage accounting, history
 * search). Every part is created once per repository instance, so per-instance state —
 * the leaf pointer ops and the message parse cache — is shared, not duplicated.
 */
export function createChatRepository(db: Kysely<AppDatabase>) {
  const leaf = createSessionLeafOps(db)
  return {
    ...createSessionReadQueries(db),
    ...createRecentRouteQueries(db),
    ...createSessionWriteQueries(db),
    ...createEmptyDraftQueries(db),
    ...createSessionTopicQueries(db),
    ...createActivatedToolQueries(db),
    ...createUsageQueries(db),
    ...createMessageQueries(db, leaf),
    ...createTreeQueries(db, leaf),
    ...createRuntimeQueries(db),
    ...createHistoryQueries(db),
  }
}

export type ChatRepository = ReturnType<typeof createChatRepository>
