import { z } from 'zod'
import { useEffect, useRef, useState } from 'react'
import { useFileResourceSync } from '@localixai/mini-app-sdk/ui/file-resource-sync'
import {
  documentSchema,
  resumeSummary,
  type Resume,
  type ResumeDocument,
  type ResumeSummary,
} from '../shared/schema'
import { createTemplateDocument, type TemplateId } from '../shared/templates'
import { documentOperations } from './diff'
import { resumeApi } from './api'
import { mergeDocuments } from './merge'
import { useResumeDraft } from './useResumeDraft'

export function useResumes(active: boolean, sessionId: string, initialId?: string) {
  const [resumes, setResumes] = useState<ResumeSummary[]>([])
  const [remote, setRemote] = useState<Resume | null>(null)
  const editor = useResumeDraft()
  const { base, draft, dirty, adopt, latest, clear } = editor
  const [validationVisible, setValidationVisible] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const busy = useRef(false)
  const lifecycle = useRef({ alive: true, ticket: 0 })
  useEffect(() => {
    const cycle = lifecycle.current
    cycle.alive = true
    return () => {
      cycle.alive = false
      cycle.ticket++
    }
  }, [])
  const isDirty = () => {
    const editing = latest.current
    return Boolean(
      editing && JSON.stringify(editing.base.document) !== JSON.stringify(editing.history.value),
    )
  }
  const { refresh } = useFileResourceSync({
    sessionId,
    prefix: '.localix/resumes',
    enabled: active && !pending,
    resetKey: initialId,
    fallbackMs: 5_000,
    read: async (signal) => {
      const list = await resumeApi.list(sessionId, signal)
      const savedBase = latest.current?.base
      const selected = list.find((item) => item.id === (savedBase?.id ?? initialId))
      const saved =
        selected && selected.revision !== savedBase?.revision
          ? await resumeApi.get(sessionId, selected.id, signal)
          : null
      return { list, selected, saved, savedBase }
    },
    apply: ({ list, selected, saved, savedBase }) => {
      if (busy.current) return
      setResumes(list)
      if (saved) {
        setRemote(saved)
        const editing = latest.current
        if (!isDirty()) adopt(saved, !editing)
      } else if (savedBase && !selected) {
        setRemote(null)
        if (!isDirty()) clear()
      }
      setReadError(
        !selected && initialId && !savedBase
          ? 'This resume link is unavailable. Choose another resume or create one.'
          : null,
      )
      setLoading(false)
    },
    onError: (reason) => {
      setReadError(reason instanceof Error ? reason.message : 'Could not read resumes. Retry.')
      setLoading(false)
    },
  })
  const action = async (run: () => Promise<Resume | null>) => {
    if (busy.current) return false
    busy.current = true
    lifecycle.current.ticket++
    setPending(true)
    setError(null)
    let failed = false
    let succeeded = false
    try {
      const result = await run()
      succeeded = true
      if (lifecycle.current.alive && result) {
        setResumes((list) => [
          ...list.filter((item) => item.id !== result.id),
          resumeSummary(result),
        ])
        setRemote(result)
        clear()
        adopt(result)
        setValidationVisible(false)
        setReadError(null)
        succeeded = true
      }
    } catch (reason) {
      failed = true
      if (lifecycle.current.alive)
        setError(
          reason instanceof z.ZodError
            ? 'Correct the marked fields before saving. Your draft is retained.'
            : reason instanceof Error
              ? reason.message
              : 'Operation failed; your draft is retained.',
        )
    } finally {
      busy.current = false
      if (lifecycle.current.alive) {
        setPending(false)
        setLoading(false)
        if (failed) void refresh()
      }
    }
    return succeeded
  }
  const canLeave = () => {
    if (!isDirty()) return true
    setError('Save or discard your draft before switching resumes.')
    return false
  }
  return {
    validationVisible,
    resumes,
    base,
    draft,
    dirty,
    error: error ?? readError,
    loading,
    pending,
    remoteChanged: Boolean(base && (remote?.id !== base.id || remote.revision !== base.revision)),
    remoteDeleted: Boolean(base && !resumes.some((item) => item.id === base.id)),
    setDraft: editor.setDraft,
    undo: editor.undo,
    redo: editor.redo,
    canUndo: editor.canUndo,
    canRedo: editor.canRedo,
    recovered: editor.recovered,
    refresh,
    createDocument: async (document: ResumeDocument) =>
      canLeave()
        ? action(() => resumeApi.create(sessionId, documentSchema.parse(document)))
        : false,
    renameResume: async (resume: ResumeSummary, title: string) =>
      canLeave()
        ? action(() =>
            resumeApi.update(sessionId, resume.id, resume.revision, [
              { op: 'metadata', value: { title } },
            ]),
          )
        : false,
    duplicateResume: async (resume: ResumeSummary) =>
      canLeave()
        ? action(() =>
            resumeApi.duplicate(sessionId, resume.id, `${resume.title.slice(0, 480)} — copy`),
          )
        : false,
    deleteResume: async (resume: ResumeSummary) =>
      canLeave()
        ? action(async () => {
            await resumeApi.remove(sessionId, resume.id, resume.revision)
            setResumes((list) => list.filter((item) => item.id !== resume.id))
            if (latest.current?.base.id === resume.id) {
              clear()
              setRemote(null)
            }
            return null
          })
        : false,
    select: (resume: ResumeSummary) => {
      if (canLeave()) void action(() => resumeApi.get(sessionId, resume.id))
    },
    create: (template: TemplateId = 'awal') => {
      if (canLeave())
        void action(() =>
          resumeApi.create(sessionId, createTemplateDocument(template, 'Untitled resume')),
        )
    },
    importDocument: (document: ResumeDocument) => {
      if (canLeave()) void action(() => resumeApi.create(sessionId, documentSchema.parse(document)))
    },
    save: async () => {
      setValidationVisible(true)
      const editing = latest.current
      if (editing)
        await action(() => {
          documentSchema.parse(editing.history.value)
          const operations = documentOperations(editing.base.document, editing.history.value)
          return operations.length
            ? resumeApi.update(sessionId, editing.base.id, editing.base.revision, operations)
            : Promise.resolve(editing.base)
        })
    },
    saveVariant: () => {
      const document = latest.current?.history.value
      if (document)
        void action(() =>
          resumeApi.create(
            sessionId,
            documentSchema.parse({
              ...document,
              title: `${document.title.slice(0, 480)} — variant`,
            }),
          ),
        )
    },
    rebase: () => {
      const editing = latest.current
      if (!editing || !remote || remote.id !== editing.base.id || busy.current) return
      const result = mergeDocuments(editing.base.document, editing.history.value, remote.document)
      if (!result.document) {
        setError(
          `Both writers changed: ${result.conflicts.join(', ')}. Your draft is retained; save it as a variant or discard it to load saved state.`,
        )
        return
      }
      editor.rebase(remote, result.document)
      setError(null)
    },
    duplicate: () => {
      if (base && canLeave())
        void action(() =>
          resumeApi.duplicate(sessionId, base.id, `${base.document.title.slice(0, 480)} — variant`),
        )
    },
    discard: () => {
      if (busy.current) return
      if (remote && remote.id === base?.id) adopt(remote)
      else clear()
      setError(null)
      void refresh()
    },
    restore: (target: string) => {
      if (base && canLeave())
        void action(() => resumeApi.restore(sessionId, base.id, base.revision, target))
    },
    remove: () => {
      if (base)
        void action(async () => {
          await resumeApi.remove(sessionId, base.id, base.revision)
          if (lifecycle.current.alive) {
            setResumes((list) => list.filter((item) => item.id !== base.id))
            clear()
            setRemote(null)
          }
          return null
        })
    },
    setError,
  }
}
