import { Hono } from 'hono'
import { zValidator } from '../../lib/validator'
import { z } from 'zod'

import type { AppContext } from '../../app'
import { defaultErrorHandler, jsonError } from '../../lib/http'
import {
  branchParamsSchema,
  checkoutBranchRequestSchema,
  forkSessionRequestSchema,
  createSessionRequestSchema,
  importSessionRequestSchema,
  toolInteractSchema,
  messageParamsSchema,
  sendMessageRequestSchema,
  sessionParamsSchema,
  switchBranchRequestSchema,
  editMessageRequestSchema,
  regenerateRequestSchema,
  updateSessionRequestSchema,
} from './contracts'
import type { ChatRoutesService } from './routes-types'
export type { ChatRoutesService } from './routes-types'
import {
  usageOverviewQuerySchema,
  usageLogsQuerySchema,
  skillInputSchema,
  fileReadQuerySchema,
  fileWriteRequestSchema,
  treeQuerySchema,
  fileCreateRequestSchema,
  fileRenameRequestSchema,
  filePasteRequestSchema,
  fileDeleteRequestSchema,
  filePathRequestSchema,
  fileSearchQuerySchema,
  contentSearchQuerySchema,
  replaceContentRequestSchema,
  answerQuestionRequestSchema,
  skipQuestionRequestSchema,
} from './routes-schemas'

export function createChatRoutes(service: ChatRoutesService) {
  const app = new Hono<AppContext>()

  const routes = app
    .get('/sessions', async (c) => {
      return c.json(await service.listSessions(c.get('userId')), 200)
    })
    .get(
      '/history-search',
      zValidator(
        'query',
        z.object({ q: z.string(), limit: z.coerce.number().int().positive().max(100).optional() }),
      ),
      async (c) => {
        const { q, limit } = c.req.valid('query')
        return c.json({ hits: await service.searchHistory(c.get('userId'), q, limit ?? 30) }, 200)
      },
    )
    .get(
      '/skills',
      zValidator('query', z.object({ projectId: z.string().optional() })),
      async (c) => {
        const { projectId } = c.req.valid('query')
        return c.json(
          await service.listSkills(c.get('userId'), {
            projectId: projectId ?? null,
          }),
          200,
        )
      },
    )
    // ONE skill, body included — what the editor opens. The LIST is a catalog and
    // rides in the capability snapshot as summaries; see `skillSummarySchema`.
    .get(
      '/skills/:name',
      zValidator('query', z.object({ projectId: z.string().optional() })),
      async (c) => {
        return c.json(
          await service.getSkill(c.get('userId'), c.req.param('name'), {
            projectId: c.req.valid('query').projectId ?? null,
          }),
          200,
        )
      },
    )
    .post('/skills', zValidator('json', skillInputSchema), async (c) => {
      return c.json(await service.createSkill(c.get('userId'), c.req.valid('json')), 201)
    })
    .delete(
      '/skills/:name',
      zValidator('query', z.object({ projectId: z.string().optional() })),
      async (c) => {
        await service.deleteSkill(
          c.get('userId'),
          c.req.param('name'),
          c.req.valid('query').projectId ?? null,
        )
        return c.body(null, 204)
      },
    )
    .post(
      '/sessions/:id/skills',
      zValidator('param', sessionParamsSchema),
      zValidator('json', z.object({ skills: z.array(z.string()) })),
      async (c) => {
        return c.json(
          await service.setSessionSkills(
            c.get('userId'),
            c.req.valid('param').id,
            c.req.valid('json').skills,
          ),
          200,
        )
      },
    )
    .post('/sessions', zValidator('json', createSessionRequestSchema), async (c) => {
      // Handles on the wire become the service's party. The mapping lives here because it is
      // transport shape meeting domain shape: the wire says WHO is in the conversation, the
      // service's richer form also says what each of them runs on, which a client never states
      // at creation — an unrouted member inherits the session's model like any other.
      const { agentIds, ...input } = c.req.valid('json')
      return c.json(
        await service.createSession(c.get('userId'), {
          ...input,
          ...(agentIds?.length ? { agents: agentIds.map((agentId) => ({ agentId })) } : {}),
        }),
        201,
      )
    })
    // Import a conversation from outside Localix. The body is our OWN message model — nothing here
    // knows what produced it, which is what lets the next importer reuse the route unchanged.
    .post('/sessions/import', zValidator('json', importSessionRequestSchema), async (c) => {
      try {
        const session = await service.importSession(c.get('userId'), c.req.valid('json'))
        return c.json(session, 201)
      } catch (error) {
        // A refused import is a caller problem (empty, too large) and its message names the limit.
        return c.json({ error: error instanceof Error ? error.message : String(error) }, 400)
      }
    })
    .get(
      '/sessions/:id',
      zValidator('param', sessionParamsSchema),
      zValidator(
        'query',
        z.object({
          // Thin clients load only the newest N messages; messageCount in the
          // response carries the full total so "load earlier" knows more exist.
          messageLimit: z.coerce.number().int().positive().max(5000).optional(),
          toolDetails: z.literal('deferred').optional(),
        }),
      ),
      async (c) => {
        return c.json(
          await service.getSession(c.get('userId'), c.req.valid('param').id, {
            messageLimit: c.req.valid('query').messageLimit,
            deferToolDetails: c.req.valid('query').toolDetails === 'deferred',
          }),
          200,
        )
      },
    )
    .get(
      '/sessions/:id/messages/:messageId/tool-details',
      zValidator('param', messageParamsSchema),
      async (c) => {
        const { id, messageId } = c.req.valid('param')
        return c.json(await service.getMessageToolDetails(c.get('userId'), id, messageId), 200)
      },
    )
    .get(
      '/sessions/:id/file',
      zValidator('param', sessionParamsSchema),
      zValidator('query', fileReadQuerySchema),
      async (c) => {
        const q = c.req.valid('query')
        return c.json(
          await service.readFile(c.get('userId'), c.req.valid('param').id, q.path, {
            full: q.full !== undefined,
            knownHash: q.knownHash,
            signal: c.req.raw.signal,
          }),
          200,
        )
      },
    )
    .put(
      '/sessions/:id/file',
      zValidator('param', sessionParamsSchema),
      zValidator('json', fileWriteRequestSchema),
      async (c) => {
        const body = c.req.valid('json')
        return c.json(
          await service.writeFile(
            c.get('userId'),
            c.req.valid('param').id,
            body.path,
            body.content,
            body.baseHash,
          ),
          200,
        )
      },
    )
    .get(
      '/sessions/:id/tree',
      zValidator('param', sessionParamsSchema),
      zValidator('query', treeQuerySchema),
      async (c) => {
        return c.json(
          await service.listDirectory(
            c.get('userId'),
            c.req.valid('param').id,
            c.req.valid('query').path,
          ),
          200,
        )
      },
    )
    .post(
      '/sessions/:id/file-create',
      zValidator('param', sessionParamsSchema),
      zValidator('json', fileCreateRequestSchema),
      async (c) => {
        const body = c.req.valid('json')
        return c.json(
          await service.createFileEntry(
            c.get('userId'),
            c.req.valid('param').id,
            body.parentPath,
            body.name,
            body.kind,
          ),
          200,
        )
      },
    )
    .post(
      '/sessions/:id/file-rename',
      zValidator('param', sessionParamsSchema),
      zValidator('json', fileRenameRequestSchema),
      async (c) => {
        const body = c.req.valid('json')
        return c.json(
          await service.renameFileEntry(
            c.get('userId'),
            c.req.valid('param').id,
            body.path,
            body.newName,
          ),
          200,
        )
      },
    )
    .post(
      '/sessions/:id/file-paste',
      zValidator('param', sessionParamsSchema),
      zValidator('json', filePasteRequestSchema),
      async (c) => {
        const body = c.req.valid('json')
        return c.json(
          await service.pasteFileEntry(
            c.get('userId'),
            c.req.valid('param').id,
            body.source,
            body.destDir,
            body.mode,
          ),
          200,
        )
      },
    )
    .post(
      '/sessions/:id/file-delete',
      zValidator('param', sessionParamsSchema),
      zValidator('json', fileDeleteRequestSchema),
      async (c) => {
        const body = c.req.valid('json')
        return c.json(
          await service.deleteFileEntry(c.get('userId'), c.req.valid('param').id, body.path, {
            permanent: body.permanent,
          }),
          200,
        )
      },
    )
    .post(
      '/sessions/:id/file-duplicate',
      zValidator('param', sessionParamsSchema),
      zValidator('json', filePathRequestSchema),
      async (c) => {
        const body = c.req.valid('json')
        return c.json(
          await service.duplicateFileEntry(c.get('userId'), c.req.valid('param').id, body.path),
          200,
        )
      },
    )
    .post('/sessions/:id/file-undo', zValidator('param', sessionParamsSchema), async (c) => {
      return c.json(await service.undoFileOp(c.get('userId'), c.req.valid('param').id), 200)
    })
    .post(
      '/sessions/:id/file-reveal',
      zValidator('param', sessionParamsSchema),
      zValidator('json', filePathRequestSchema),
      async (c) => {
        const body = c.req.valid('json')
        return c.json(
          await service.revealFileEntry(c.get('userId'), c.req.valid('param').id, body.path),
          200,
        )
      },
    )
    .get(
      '/sessions/:id/files',
      zValidator('param', sessionParamsSchema),
      zValidator('query', fileSearchQuerySchema),
      async (c) => {
        const { q, limit, offset, mode, type, ext, includeIgnored } = c.req.valid('query')
        return c.json(
          await service.findFiles(c.get('userId'), c.req.valid('param').id, q ?? '', {
            limit,
            offset,
            mode,
            type,
            extensions: ext
              ? ext
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean)
              : undefined,
            includeIgnored,
          }),
          200,
        )
      },
    )
    .get(
      '/sessions/:id/search-content',
      zValidator('param', sessionParamsSchema),
      zValidator('query', contentSearchQuerySchema),
      async (c) => {
        const {
          q,
          limit,
          regex,
          caseSensitive,
          wholeWord,
          glob,
          excludeGlob,
          contextLines,
          includeIgnored,
        } = c.req.valid('query')
        return c.json(
          await service.searchContent(c.get('userId'), c.req.valid('param').id, q ?? '', {
            limit,
            regex,
            caseSensitive,
            wholeWord,
            glob,
            excludeGlob,
            contextLines,
            includeIgnored,
          }),
          200,
        )
      },
    )
    .post(
      '/sessions/:id/replace-content',
      zValidator('param', sessionParamsSchema),
      zValidator('json', replaceContentRequestSchema),
      async (c) => {
        const {
          q,
          replacement,
          regex,
          caseSensitive,
          wholeWord,
          glob,
          excludeGlob,
          includeIgnored,
        } = c.req.valid('json')
        return c.json(
          await service.replaceContent(c.get('userId'), c.req.valid('param').id, q, replacement, {
            regex,
            caseSensitive,
            wholeWord,
            glob,
            excludeGlob,
            includeIgnored,
          }),
          200,
        )
      },
    )
    .patch(
      '/sessions/:id',
      zValidator('param', sessionParamsSchema),
      zValidator('json', updateSessionRequestSchema),
      async (c) => {
        // Same wire-to-domain mapping as creation: the client states membership, the service
        // owns what each participant runs on (`reseatParticipants` keeps a survivor's own route).
        const { agentIds, ...patch } = c.req.valid('json')
        return c.json(
          await service.updateSession(c.get('userId'), c.req.valid('param').id, {
            ...patch,
            ...(agentIds?.length ? { agents: agentIds.map((agentId) => ({ agentId })) } : {}),
          }),
          200,
        )
      },
    )
    .delete('/sessions/:id', zValidator('param', sessionParamsSchema), async (c) => {
      await service.deleteSession(c.get('userId'), c.req.valid('param').id)
      return c.body(null, 204)
    })
    .post(
      '/sessions/:id/messages',
      zValidator('param', sessionParamsSchema),
      zValidator('json', sendMessageRequestSchema),
      async (c) => {
        return c.json(
          await service.sendMessage(
            c.get('userId'),
            c.req.valid('param').id,
            c.req.valid('json').prompt,
            c.req.valid('json').bindings,
            undefined,
            c.req.valid('json').isInternal,
            c.req.valid('json').toolSurface,
            c.req.valid('json').clientMessageId,
          ),
          202,
        )
      },
    )
    .post(
      '/sessions/:id/regenerate',
      zValidator('param', sessionParamsSchema),
      zValidator('json', regenerateRequestSchema),
      async (c) => {
        return c.json(
          await service.regenerate(
            c.get('userId'),
            c.req.valid('param').id,
            c.req.valid('json').toolSurface,
            c.req.valid('json').expectedMessageId,
          ),
          202,
        )
      },
    )
    .post(
      '/sessions/:id/messages/:messageId/rollback',
      zValidator('param', messageParamsSchema),
      async (c) => {
        const { id, messageId } = c.req.valid('param')
        return c.json(await service.rollback(c.get('userId'), id, messageId), 200)
      },
    )
    .post(
      '/sessions/:id/messages/:messageId/reactions',
      zValidator('param', messageParamsSchema),
      zValidator('json', z.object({ emoji: z.string().min(1).max(16) })),
      async (c) => {
        const { id, messageId } = c.req.valid('param')
        return c.json(
          await service.reactToMessage(c.get('userId'), id, messageId, c.req.valid('json').emoji),
          200,
        )
      },
    )
    .post(
      '/sessions/:id/messages/:messageId/pin',
      zValidator('param', messageParamsSchema),
      zValidator('json', z.object({ pinned: z.boolean() })),
      async (c) => {
        const { id, messageId } = c.req.valid('param')
        return c.json(
          await service.pinMessage(c.get('userId'), id, messageId, c.req.valid('json').pinned),
          200,
        )
      },
    )
    .post(
      '/sessions/:id/messages/:messageId/tasks',
      zValidator('param', messageParamsSchema),
      zValidator('json', z.object({ key: z.string().min(1).max(200), checked: z.boolean() })),
      async (c) => {
        const { id, messageId } = c.req.valid('param')
        const { key, checked } = c.req.valid('json')
        return c.json(
          await service.checkMessageTask(c.get('userId'), id, messageId, key, checked),
          200,
        )
      },
    )
    .post(
      '/sessions/:id/messages/:messageId/edit',
      zValidator('param', messageParamsSchema),
      zValidator('json', editMessageRequestSchema),
      async (c) => {
        const { id, messageId } = c.req.valid('param')
        const { content, toolSurface } = c.req.valid('json')
        return c.json(
          await service.editMessage(c.get('userId'), id, messageId, content, toolSurface),
          202,
        )
      },
    )
    .post(
      '/sessions/:id/messages/:messageId/thread',
      zValidator('param', messageParamsSchema),
      async (c) => {
        const { id, messageId } = c.req.valid('param')
        return c.json(await service.openMessageThread(c.get('userId'), id, messageId), 200)
      },
    )
    .post(
      '/sessions/:id/messages/:messageId/switch-branch',
      zValidator('param', branchParamsSchema),
      zValidator('json', switchBranchRequestSchema),
      async (c) => {
        const { id, messageId } = c.req.valid('param')
        return c.json(
          await service.switchBranch(
            c.get('userId'),
            id,
            messageId,
            c.req.valid('json').branchIndex,
          ),
          200,
        )
      },
    )
    .get('/sessions/:id/branches', zValidator('param', sessionParamsSchema), async (c) => {
      return c.json(await service.getBranchTree(c.get('userId'), c.req.valid('param').id), 200)
    })
    .post(
      '/sessions/:id/branches/checkout',
      zValidator('param', sessionParamsSchema),
      zValidator('json', checkoutBranchRequestSchema),
      async (c) => {
        return c.json(
          await service.checkoutBranch(
            c.get('userId'),
            c.req.valid('param').id,
            c.req.valid('json').messageId,
          ),
          200,
        )
      },
    )
    .post(
      '/sessions/:id/fork',
      zValidator('param', sessionParamsSchema),
      zValidator('json', forkSessionRequestSchema),
      async (c) => {
        return c.json(
          await service.forkSession(
            c.get('userId'),
            c.req.valid('param').id,
            c.req.valid('json').messageId,
          ),
          201,
        )
      },
    )
    .post('/sessions/:id/stop', zValidator('param', sessionParamsSchema), async (c) => {
      const stopped = await service.stop(c.req.valid('param').id, c.get('userId'))
      return c.json({ stopped }, 200)
    })
    .post(
      '/sessions/:id/monitors/stop',
      zValidator('param', sessionParamsSchema),
      zValidator('json', z.object({ monitorId: z.string().min(1) })),
      async (c) => {
        // Session-scoped on purpose: a monitor id is per-session (`mon-1`), so the pair is
        // what identifies one — and the service checks the OWNER before stopping anything.
        const stopped = service.stopSessionMonitor(
          c.get('userId'),
          c.req.valid('param').id,
          c.req.valid('json').monitorId,
        )
        return c.json({ stopped }, 200)
      },
    )
    // A queued question is answered by its session-scoped id (`q-3`), never by tool call: the
    // call that asked returned long ago, and nothing in the HITL registry still waits on it.
    .post(
      '/sessions/:id/questions/answer',
      zValidator('param', sessionParamsSchema),
      zValidator('json', answerQuestionRequestSchema),
      async (c) => {
        const { questionId, answers } = c.req.valid('json')
        return c.json(
          await service.answerQuestion(
            c.get('userId'),
            c.req.valid('param').id,
            questionId,
            answers,
          ),
          200,
        )
      },
    )
    .post(
      '/sessions/:id/questions/skip',
      zValidator('param', sessionParamsSchema),
      zValidator('json', skipQuestionRequestSchema),
      async (c) =>
        c.json(
          await service.skipQuestion(
            c.get('userId'),
            c.req.valid('param').id,
            c.req.valid('json').questionId,
          ),
          200,
        ),
    )
    .post('/tools/interact', zValidator('json', toolInteractSchema), async (c) => {
      const { toolCallId, action, payload } = c.req.valid('json')
      const result = service.interact(toolCallId, action, payload, c.get('userId'))
      if (!result.ok)
        return jsonError(c, 404, 'interaction_failed', result.error ?? 'Interaction failed')
      return c.json({ ok: true }, 200)
    })
    // ── Usage / spend analytics (powers the stats dashboard) ──────────────
    .get('/usage/overview', zValidator('query', usageOverviewQuerySchema), async (c) => {
      const { from, to, groupBy, bucket, model, provider, session, agent } = c.req.valid('query')
      return c.json(
        await service.usageOverview(c.get('userId'), {
          from,
          to,
          groupBy: groupBy ?? 'model',
          bucket: bucket ?? 'day',
          model,
          provider,
          session,
          agent,
        }),
        200,
      )
    })
    .get('/usage/logs', zValidator('query', usageLogsQuerySchema), async (c) => {
      const { from, to, model, provider, session, agent, cursor, limit } = c.req.valid('query')
      return c.json(
        await service.usageLogs(c.get('userId'), {
          from,
          to,
          model,
          provider,
          session,
          agent,
          cursor,
          limit,
        }),
        200,
      )
    })
    .get('/usage/keys', async (c) => {
      return c.json(await service.usageKeys(c.get('userId')), 200)
    })
    .post('/loops/cancel', zValidator('json', z.object({ id: z.string().min(1) })), async (c) => {
      const { id } = c.req.valid('json')
      const removed = await service.cancelSessionLoop(c.get('userId'), id)
      return c.json({ removed }, 200)
    })
    .post('/loops/run', zValidator('json', z.object({ id: z.string().min(1) })), async (c) => {
      const { id } = c.req.valid('json')
      const fired = await service.runSessionLoop(c.get('userId'), id)
      return c.json({ fired }, 200)
    })
    .post(
      '/sessions/:id/queue/remove',
      zValidator('param', sessionParamsSchema),
      zValidator('json', z.object({ itemId: z.string().min(1) })),
      async (c) => {
        const { itemId } = c.req.valid('json')
        const result = await service.removeQueuedMessage(
          c.get('userId'),
          c.req.valid('param').id,
          itemId,
        )
        return c.json(result, 200)
      },
    )
    .post(
      '/sessions/:id/queue/send-now',
      zValidator('param', sessionParamsSchema),
      zValidator('json', z.object({ itemId: z.string().min(1) })),
      async (c) => {
        const { itemId } = c.req.valid('json')
        return c.json(
          await service.interruptAndPromoteQueuedMessage(
            c.get('userId'),
            c.req.valid('param').id,
            itemId,
          ),
          200,
        )
      },
    )
    .post('/sessions/:id/queue/clear', zValidator('param', sessionParamsSchema), async (c) => {
      return c.json(
        await service.clearQueuedMessages(c.get('userId'), c.req.valid('param').id),
        200,
      )
    })

  routes.onError(defaultErrorHandler)

  return routes
}
