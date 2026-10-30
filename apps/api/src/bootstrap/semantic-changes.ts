/**
 * Semantic search on the core change feed, assembled from what each feature declares: chat its
 * chats and messages, each capability feature its catalog. This file only gathers the targets;
 * what a change means for the index is `embeddings/targets.ts`, and what each kind is, its owner.
 * `satisfies` keeps the map whole: a kind added to the core registry fails here until it has a
 * target, or `'ignore'`.
 */
import type { Kysely } from 'kysely'
import type { AppDatabase } from '../db/types'
import { agentsSemanticTarget } from '../features/agents/semantic'
import type { CoreCascades, CoreChangeFeed, CoreRefs } from '../features/changes/core-entities'
import { chatSemanticTargets } from '../features/chat/repository-semantic-sources'
import type { SemanticService } from '../features/embeddings/service'
import type { LocalModelsService } from '../features/local-models/service'
import type { createLogger } from '../lib/logger'
import { startChangeFeedRetention, type ChangeFeeds } from './change-feed'
import { semanticHandlers, type SemanticTargets } from '../features/embeddings/targets'
import { mcpSemanticTarget } from '../features/mcp/semantic'
import { pluginsSemanticTarget } from '../features/plugins/semantic'
import { skillsSemanticTarget } from '../features/skills-curator/semantic'

export function coreSemanticTargets(db: Kysely<AppDatabase>) {
  return {
    ...chatSemanticTargets(db),
    skill: skillsSemanticTarget,
    plugin: pluginsSemanticTarget,
    'mini-app': 'ignore',
    'mini-app.marketplace': 'ignore',
    'mini-app.updates': 'ignore',
    mcp: mcpSemanticTarget,
    agent: agentsSemanticTarget,
    project: 'ignore',
    'capability.rule': 'ignore',
    'local.model': 'ignore',
    'project.settings': 'ignore',
    'user.profile': 'ignore',
    'user.agent-settings': 'ignore',
    'user.view-state': 'ignore',
    secret: 'ignore',
    'system.toggle': 'ignore',
    'provider.connection': 'ignore',
  } satisfies SemanticTargets<CoreRefs>
}

export function subscribeSemanticToChanges(deps: {
  db: Kysely<AppDatabase>
  feed: CoreChangeFeed
  semantic: Pick<SemanticService, 'changed' | 'resync' | 'removeUnder'>
}) {
  return deps.feed.subscribe(
    'semantic-index',
    semanticHandlers<CoreRefs, CoreCascades>(coreSemanticTargets(deps.db), deps.semantic),
    // The index is derived data: it can be dropped and rebuilt from the owners.
    { kind: 'projector' },
  )
}

/**
 * Post-listen: local models first (semantic search may want one of them), then semantic search,
 * then its subscription to the feed; the feed's retention runs from here on.
 */
export function startSemantic(deps: {
  db: Kysely<AppDatabase>
  logger: ReturnType<typeof createLogger>
  localModels: Pick<LocalModelsService, 'boot'>
  semanticService: SemanticService
  changes: ChangeFeeds
  signal?: AbortSignal
}): void {
  const { db, semanticService: semantic } = deps
  const feed = deps.changes.core
  void deps.localModels
    .boot()
    .then(() => semantic.boot())
    .then(() => subscribeSemanticToChanges({ db, feed, semantic }))
    .catch((err: unknown) =>
      deps.logger.warn({ event: 'semantic.boot_failed', error: String(err) }),
    )
  startChangeFeedRetention(deps.changes, deps.signal)
}
