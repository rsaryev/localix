import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, Clock3, Download, GraduationCap, Upload } from 'lucide-react'
import { acknowledgeInline, toast } from '@localixai/mini-app-sdk/ui'
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { miniAppFiles } from '@localixai/mini-app-sdk/ui/runtime'

import { Button } from '@localixai/kit/button'
import { ComposerCommandButton } from '@localixai/kit/composer-command-button'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { PanelHeader } from '@localixai/kit/panel-header'
import { ProgressBar } from '@localixai/kit/progress-bar'
import { Spinner } from '@localixai/kit/spinner'
import { StateNotice } from '@localixai/kit/state-notice'
import { useProblemReport } from '@localixai/mini-app-sdk/ui'
import { ProblemLine } from '@localixai/mini-app-sdk/ui/components'
import type { ProblemReport } from '@localixai/mini-app-sdk/ui/problems'
import type { CourseSummary } from '../shared/contracts'
import { LearningApiError, learningApi } from './api/learningApi'
import { openLearningCourse } from './model/openCourse'
import { useCourseChanges } from './model/courseChanges'

/**
 * The course library of ONE chat — the one its tab belongs to (`sessionId`).
 *
 * It read the chat in front once: kept mounted after the person switched chats, the library then
 * listed, imported into and exported from the other chat while sitting in this one's tab.
 */
export function LearningLibrary({
  sessionId,
  visible = true,
}: {
  sessionId: string
  visible?: boolean
}) {
  const [courses, setCourses] = useState<CourseSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** The raw text behind `error`. Event Center only, never on the line. */
  const [errorDetail, setErrorDetail] = useState<string | null>(null)
  /**
   * One sentence on the line, the raw text one click away — never both on the line.
   *
   * Only the ROUTE's message is a sentence (it comes from `defineTypedError`). Everything else that
   * can be thrown here is not: `TypeError: Failed to fetch` went straight onto the line and took
   * the whole pane with it, and the fallback below never ran.
   */
  const setFailure = (cause: unknown) => {
    const routed = cause instanceof LearningApiError
    acknowledgeInline(cause)
    setError(routed ? cause.message : 'The course library could not be read.')
    setErrorDetail(
      routed ? (cause.detail ?? null) : cause instanceof Error ? cause.message : String(cause),
    )
  }
  const [importing, setImporting] = useState(false)
  const [exportingId, setExportingId] = useState<string | null>(null)
  const request = useRef(0)
  const importInput = useRef<HTMLInputElement>(null)

  const refresh = useCallback(() => {
    const sequence = ++request.current
    return learningApi
      .list(sessionId)
      .then((next) => {
        if (sequence !== request.current) return
        setCourses(next)
        setError(null)
      })
      .catch((cause) => {
        if (sequence !== request.current) return
        setFailure(cause)
      })
  }, [sessionId])

  // Another chat starts from an empty library: reset while rendering, not in an effect afterwards.
  const [listedSession, setListedSession] = useState(sessionId)
  if (listedSession !== sessionId) {
    setListedSession(sessionId)
    setCourses(null)
    setError(null)
  }
  useEffect(() => {
    request.current += 1
    void refresh()
  }, [refresh])

  useCourseChanges(sessionId, visible, refresh)

  const exportCourse = async (course: CourseSummary) => {
    setExportingId(course.id)
    try {
      const { blob, filename } = await learningApi.exportCourse(sessionId, course.id)
      await miniAppFiles.saveBlob(filename, blob)
    } catch (cause) {
      toast.error(`Could not export “${course.title}”`, {
        description: errorMessage(cause, '') || undefined,
      })
    } finally {
      setExportingId(null)
    }
  }

  const importCourse = async (file: File) => {
    setImporting(true)
    try {
      const course = await learningApi.importCourse(sessionId, file)
      await refresh()
      // Opening the imported course is the confirmation; a success row would only repeat it.
      openLearningCourse(course.sessionId, course.id, course.title)
    } catch (cause) {
      toast.error(`Could not import “${file.name}”`, {
        description: errorMessage(cause, '') || undefined,
      })
    } finally {
      setImporting(false)
      if (importInput.current) importInput.current.value = ''
    }
  }

  const report = useMemo<ProblemReport | null>(
    () =>
      error
        ? {
            subject: { label: 'Course library' },
            problems: [{ severity: 'error', message: error, detail: errorDetail ?? undefined }],
            consequence: 'blocked',
          }
        : null,
    [error, errorDetail],
  )
  const problem = useProblemReport(report, { scope: 'learning', sourceVisible: true })

  if (!courses && !error) return <LoadingHint>Opening course library…</LoadingHint>

  // No ground coat: the hosting pane already paints one, and under the host's macOS glass theme
  // the ground tokens carry alpha — a second pane-sized coat compounds into an opaque slab.
  return (
    <div className="@container flex h-full min-h-0 min-w-0 flex-col text-foreground">
      <PanelHeader
        tone="content"
        title="Learning"
        actions={
          <>
            <input
              ref={importInput}
              type="file"
              accept=".localix-course,application/vnd.localix.learning-course+json"
              className="hidden"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                if (file) void importCourse(file)
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={importing}
              onClick={() => importInput.current?.click()}
            >
              {importing ? <Spinner className="size-3" /> : <Upload aria-hidden="true" />}
              Import
            </Button>
            <ComposerCommandButton
              command="/learning:create"
              insertText="/learning:create "
              sessionId={sessionId}
            />
          </>
        }
      />
      {problem ? (
        <ProblemLine
          {...problem}
          className="min-h-0 flex-1 items-center justify-center px-6 py-8 text-center"
        />
      ) : courses?.length === 0 ? (
        <StateNotice
          icon={GraduationCap}
          title="No courses yet"
          body={
            <span className="inline-flex flex-wrap items-center justify-center gap-1">
              Build a file-authored course with
              <ComposerCommandButton
                command="/learning:create"
                insertText="/learning:create "
                sessionId={sessionId}
              />
            </span>
          }
        />
      ) : (
        <div className="scrollbar-thin min-h-0 flex-1 overflow-auto p-4" data-scrollable>
          <div className="grid gap-2 @3xl:grid-cols-2 @6xl:grid-cols-3">
            {courses?.map((course) => {
              const progress =
                course.totalLessons === 0
                  ? 0
                  : Math.round((course.completedLessons / course.totalLessons) * 100)
              return (
                <article
                  key={course.id}
                  // The standard hover veil, not the field fill (`--input` is for typed-into
                  // controls; a card row hovers the same way every other row does).
                  className="group flex min-h-28 min-w-0 flex-col rounded-lg border border-border-soft transition-colors hover:bg-surface-hover"
                >
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-auto min-w-0 flex-1 items-start justify-start gap-3 self-stretch whitespace-normal p-4 text-left"
                    onClick={() => openLearningCourse(course.sessionId, course.id, course.title)}
                  >
                    <BookOpen className="mt-0.5 size-4 shrink-0 text-text-faint" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{course.title}</span>
                      <span className="mt-1 line-clamp-2 text-xs/5 font-normal text-text-soft">
                        {course.description}
                      </span>
                      <span className="mt-3 flex items-center gap-2">
                        <ProgressBar
                          value={progress}
                          aria-label={`${course.title} completion`}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-valuenow={progress}
                          className="h-1 flex-1"
                        />
                        <span className="text-2xs tabular-nums text-text-faint">
                          {course.completedLessons}/{course.totalLessons}
                        </span>
                        <span className="flex items-center gap-1 text-2xs text-text-faint">
                          <Clock3 className="size-3" /> {course.estimatedMinutes} min
                        </span>
                      </span>
                    </span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="mb-3 mr-3 shrink-0 self-end text-text-soft"
                    disabled={exportingId === course.id}
                    onClick={() => void exportCourse(course)}
                  >
                    {exportingId === course.id ? (
                      <Spinner className="size-3" />
                    ) : (
                      <Download aria-hidden="true" />
                    )}
                    Export
                  </Button>
                </article>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
