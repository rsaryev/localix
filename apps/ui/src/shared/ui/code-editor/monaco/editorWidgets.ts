import type * as Monaco from 'monaco-editor'
import type { EditorHunk, EditorReference, EditorSelectionRange } from '../types'
import { matchesChord } from '@/shared/lib/keybindings'

interface CommentInput {
  selection: EditorSelectionRange
  initialBody?: string
  label: string
  submitLabel: string
  onSubmit(body: string): void
}

export function createEditorWidgets(
  editor: Monaco.editor.IStandaloneCodeEditor,
  model: Monaco.editor.ITextModel,
) {
  let closeActive: (() => void) | undefined
  let sequence = 0

  const mount = (
    root: HTMLElement,
    lineNumber: number,
    options: {
      allowEditorOverflow?: boolean
      column?: number
      onBeforeRender?: () => void
      onClose?: () => void
      trackLayout?: boolean
    } = {},
  ) => {
    closeActive?.()
    const id = `localix.editorWidget.${++sequence}`
    const widget: Monaco.editor.IContentWidget = {
      getId: () => id,
      getDomNode: () => root,
      getPosition: () => ({
        position: {
          lineNumber,
          column: options.column ?? model.getLineMaxColumn(lineNumber),
        },
        preference: [2, 1],
      }),
      beforeRender: () => {
        options.onBeforeRender?.()
        return null
      },
      allowEditorOverflow: options.allowEditorOverflow ?? true,
      suppressMouseDown: true,
    }
    const layoutDisposable = options.trackLayout
      ? editor.onDidLayoutChange(() => editor.layoutContentWidget(widget))
      : undefined
    const close = () => {
      editor.removeContentWidget(widget)
      layoutDisposable?.dispose()
      options.onClose?.()
      if (closeActive === close) closeActive = undefined
      editor.focus()
    }
    closeActive = close
    editor.addContentWidget(widget)
    return close
  }

  const openComment = (input: CommentInput) => {
    const form = document.createElement('form')
    form.className = 'localix-monaco-composer'
    form.setAttribute('aria-label', input.label)

    const header = document.createElement('div')
    header.className = 'localix-monaco-composer-header'
    header.textContent = input.label
    const textarea = document.createElement('textarea')
    textarea.className = 'localix-monaco-composer-input'
    textarea.placeholder = 'Add a review comment…'
    textarea.value = input.initialBody ?? ''
    textarea.rows = 3
    const actions = document.createElement('div')
    actions.className = 'localix-monaco-composer-actions'
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.className = 'localix-monaco-suggestion-button'
    cancel.textContent = 'Cancel'
    const submit = document.createElement('button')
    submit.type = 'submit'
    submit.className = 'localix-monaco-suggestion-button localix-monaco-suggestion-primary'
    submit.textContent = input.submitLabel
    actions.append(cancel, submit)
    form.append(header, textarea, actions)

    const lineNumber = Math.min(Math.max(input.selection.endLine + 1, 1), model.getLineCount())
    const close = mount(form, lineNumber)
    cancel.addEventListener('click', close)
    const commit = () => {
      const body = textarea.value.trim()
      if (!body) return
      input.onSubmit(body)
      close()
    }
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      commit()
    })
    textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      } else if (matchesChord(event, 'mod+enter')) {
        event.preventDefault()
        commit()
      }
    })
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    })
  }

  const openRevert = (hunk: EditorHunk, onConfirm: () => Promise<void>, onDone?: () => void) => {
    const root = document.createElement('section')
    root.className = 'localix-monaco-revert'
    root.setAttribute('aria-label', 'Confirm revert change')
    const header = document.createElement('header')
    header.className = 'localix-monaco-revert-header'
    const title = document.createElement('span')
    title.textContent = 'Revert this change?'
    const actions = document.createElement('div')
    actions.className = 'localix-monaco-suggestion-actions'
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.className = 'localix-monaco-suggestion-button'
    cancel.textContent = 'Cancel'
    const confirm = document.createElement('button')
    confirm.type = 'button'
    confirm.className = 'localix-monaco-suggestion-button localix-monaco-revert-danger'
    confirm.textContent = 'Revert'
    actions.append(cancel, confirm)
    header.append(title, actions)
    const diff = document.createElement('pre')
    diff.className = 'localix-monaco-revert-diff'
    diff.textContent = [
      ...hunk.newLines.map((line) => `− ${line}`),
      ...hunk.oldLines.map((line) => `+ ${line}`),
    ].join('\n')
    const error = document.createElement('div')
    error.className = 'localix-monaco-revert-error'
    root.append(header, diff, error)
    const lineNumber = Math.min(Math.max(hunk.modifiedEnd, 1), model.getLineCount())
    const close = mount(root, lineNumber)
    cancel.addEventListener('click', close)
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close()
    })
    confirm.addEventListener('click', () => {
      confirm.disabled = true
      confirm.textContent = 'Reverting…'
      void onConfirm()
        .then(() => {
          close()
          onDone?.()
        })
        .catch((cause: unknown) => {
          confirm.disabled = false
          confirm.textContent = 'Revert'
          error.textContent =
            cause instanceof Error ? cause.message : 'Could not revert this change'
        })
    })
    requestAnimationFrame(() => cancel.focus())
  }

  const openReferences = (
    label: string,
    references: EditorReference[],
    onNavigate: (reference: EditorReference) => void,
  ) => {
    const root = document.createElement('section')
    root.className = 'localix-monaco-references'
    root.setAttribute('aria-label', `${label} (${references.length})`)
    const header = document.createElement('header')
    header.className = 'localix-monaco-references-header'
    const title = document.createElement('span')
    title.textContent = `${label} (${references.length})`
    const closeButton = document.createElement('button')
    closeButton.type = 'button'
    closeButton.className = 'localix-monaco-references-close'
    closeButton.textContent = '×'
    closeButton.setAttribute('aria-label', `Close ${label.toLowerCase()}`)
    header.append(title, closeButton)
    const list = document.createElement('div')
    list.className = 'localix-monaco-references-list'
    list.setAttribute('role', 'listbox')
    for (const reference of references) {
      const row = document.createElement('button')
      row.type = 'button'
      row.className = 'localix-monaco-reference-row'
      row.setAttribute('role', 'option')
      const location = document.createElement('span')
      location.className = 'localix-monaco-reference-location'
      location.textContent = `${reference.fileLabel}:${reference.line + 1}`
      const preview = document.createElement('code')
      preview.className = 'localix-monaco-reference-preview'
      preview.textContent = reference.preview.trim() || ' '
      row.append(location, preview)
      row.addEventListener('click', () => {
        onNavigate(reference)
        close()
      })
      list.appendChild(row)
    }
    root.append(header, list)
    const lineNumber = editor.getPosition()?.lineNumber ?? 1
    const stopEditorWheel = (event: WheelEvent) => {
      event.stopPropagation()
    }
    list.addEventListener('wheel', stopEditorWheel, { passive: true })
    const close = mount(root, lineNumber, {
      allowEditorOverflow: false,
      column: 1,
      trackLayout: true,
      onBeforeRender: () => {
        const layout = editor.getLayoutInfo()
        root.style.width = `${Math.max(Math.min(560, layout.contentWidth - 16), 1)}px`
        list.style.maxHeight = `${Math.max(Math.min(260, layout.height - 80), 96)}px`
      },
      onClose: () => list.removeEventListener('wheel', stopEditorWheel),
    })
    closeButton.addEventListener('click', close)
    root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return
      }
      const rows = [...list.querySelectorAll<HTMLButtonElement>('button')]
      const current = rows.indexOf(document.activeElement as HTMLButtonElement)
      const index =
        event.key === 'ArrowDown'
          ? Math.min(current + 1, rows.length - 1)
          : event.key === 'ArrowUp'
            ? Math.max(current - 1, 0)
            : event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? rows.length - 1
                : -1
      if (index >= 0) {
        event.preventDefault()
        rows[index]?.focus()
      }
    })
    requestAnimationFrame(() => (list.querySelector('button') as HTMLButtonElement | null)?.focus())
  }

  return { openComment, openRevert, openReferences, dispose: () => closeActive?.() }
}
