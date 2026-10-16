import { memo } from 'react'
import { MessageCircleQuestion, X } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { CollapsibleStrip } from '@localixai/kit/collapsible-strip'
import {
  WorkbenchListRow,
  WorkbenchListRowActions,
  WorkbenchListRowTrigger,
} from '@localixai/kit/workbench-list-row'
import type { SessionQuestion } from '@/shared/api/contracts'
import { formatRelativeTime } from '@localixai/plugin-sdk/ui/utilities'
import { useChatStore } from '../../model/store'
import { findSessionInState } from '../../model/findSession'
import { useQuestionUiStore } from '../../model/questionUi'
import { useQuestionActions } from '../../model/useQuestionActions'

const EMPTY: readonly SessionQuestion[] = []

/**
 * The questions the agent queued for the person (`ask` with `wait: false`) — open until they are
 * answered or skipped, whenever that is.
 *
 * The strip only lists questions. A row or "Answer" selects one in the chat's shared composer
 * slot; Answer later restores the message draft and leaves the question in this list.
 *
 * Reads the `questions` the server pushes (`session_questions.updated`), so a question appears
 * when it is asked and leaves when any tab answers it. Loaded by `QuestionsStrip` only once a
 * session has one.
 */
export const QuestionsPanel = memo(function QuestionsPanel({
  sessionId,
  recommendAnswer = false,
}: {
  sessionId: string | null
  /** Answering is the composer's expected next step (`QuestionsStrip` decides when). */
  recommendAnswer?: boolean
}) {
  const questions =
    useChatStore((state) => findSessionInState(state, sessionId)?.questions) ?? EMPTY
  const agents = useChatStore((state) => findSessionInState(state, sessionId)?.agents)
  const openId = useQuestionUiStore((state) => sessionId && state.openBySession[sessionId])
  const { submitting, skip } = useQuestionActions(sessionId)
  if (!sessionId || questions.length === 0) return null

  // A question answered elsewhere closes its card here too: the push removed it.
  const open = questions.find((question) => question.id === openId) ?? null
  // In a room the person needs to know WHO is asking; alone with one agent, it is obvious.
  const askerOf = (question: SessionQuestion) =>
    agents && agents.length > 1
      ? agents.find((agent) => agent.agentId === question.agentId)?.handle
      : undefined

  const first = questions[0]!
  return (
    <>
      <CollapsibleStrip
        label={{ expand: 'Show questions from the agent', collapse: 'Hide questions' }}
        icon={<MessageCircleQuestion className="size-3.5" />}
        count={questions.length}
        title="Questions from the agent — answer when you like"
        listLabel="Questions from the agent"
        summary={<span className="truncate">{first.questions[0]?.question}</span>}
        actionsLabel="Question actions"
        actions={
          !open && (
            <Button
              variant="ghost"
              size="sm"
              className="mr-1.5 text-text-strong hover:bg-surface-active"
              recommended={recommendAnswer}
              onClick={() => useQuestionUiStore.getState().open(sessionId, first.id)}
            >
              Answer
            </Button>
          )
        }
      >
        {questions.map((question) => {
          const asker = askerOf(question)
          const more = question.questions.length - 1
          return (
            <WorkbenchListRow key={question.id} role="listitem" density="dense">
              <WorkbenchListRowTrigger
                onClick={() => useQuestionUiStore.getState().open(sessionId, question.id)}
                aria-expanded={openId === question.id}
                aria-label={`Answer ${question.id}: ${question.questions[0]?.question ?? ''}`}
                className="px-0"
                title={question.questions.map((q) => q.question).join('\n')}
              >
                <span className="shrink-0 font-mono text-2xs text-text-faint">{question.id}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-text-soft">
                  {question.questions[0]?.question}
                </span>
                {more > 0 && (
                  <span className="shrink-0 tabular-nums text-2xs text-text-faint">+{more}</span>
                )}
                {asker && <span className="shrink-0 text-2xs text-text-faint">@{asker}</span>}
                <span className="shrink-0 tabular-nums text-2xs text-text-faint">
                  {/* The sidebar's own clock words ("5m"), so both say the same age. */}
                  {formatRelativeTime(Date.parse(question.askedAt))}
                </span>
              </WorkbenchListRowTrigger>
              <WorkbenchListRowActions aria-label={`${question.id} actions`}>
                <IconButton
                  size="md"
                  disabled={submitting}
                  aria-label={`Skip ${question.id}`}
                  tooltip="Skip — the agent decides without you"
                  tooltipSide="top"
                  onClick={() => void skip(question)}
                  className="ring-1 ring-inset ring-control-border/55 hover:bg-surface-hover"
                >
                  <X className="size-3" />
                </IconButton>
              </WorkbenchListRowActions>
            </WorkbenchListRow>
          )
        })}
      </CollapsibleStrip>
    </>
  )
})
