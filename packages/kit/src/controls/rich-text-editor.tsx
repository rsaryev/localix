import { useEffect, useId, useMemo, useRef, useState, type AriaAttributes } from 'react'
import { Extension } from '@tiptap/core'
import { EditorState, Plugin } from '@tiptap/pm/state'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import {
  cn,
  FIELD_SURFACE,
  CONTROL_FOCUS_VISIBLE,
  CONTROL_INVALID,
} from '@localixai/mini-app-sdk/ui/classes'
import {
  richTextDocument,
  richTextSchema,
  richTextToText,
  isRichTextHref,
  type RichTextDocument,
  type RichTextValue,
} from '@localixai/mini-app-sdk/rich-text'
import { useFieldControlProps } from './field'
import { RichTextToolbar } from './rich-text-toolbar'

export interface RichTextEditorProps extends Pick<
  AriaAttributes,
  | 'aria-label'
  | 'aria-labelledby'
  | 'aria-describedby'
  | 'aria-invalid'
  | 'aria-readonly'
  | 'aria-required'
> {
  value: RichTextValue
  onChange: (value: RichTextDocument) => void
  maxLength?: number
  disabled?: boolean
  readOnly?: boolean
  id?: string
  className?: string
}

/** Controlled prose: paragraphs, bold, italic, lists and safe links, stored as JSON. */
export function RichTextEditor({
  value,
  onChange,
  maxLength = 100_000,
  className,
  ...props
}: RichTextEditorProps) {
  const control = useFieldControlProps(props)
  const feedbackId = useId()
  const [feedback, setFeedback] = useState('')
  const disabled = Boolean(
    control.disabled ||
    control.readOnly ||
    control['aria-readonly'] === true ||
    control['aria-readonly'] === 'true',
  )
  const current = useRef({ onChange, maxLength })
  current.current = { onChange, maxLength }
  const bounds = useMemo(
    () =>
      Extension.create({
        name: 'boundedRichText',
        addProseMirrorPlugins() {
          return [
            new Plugin({
              filterTransaction(transaction) {
                if (!transaction.docChanged) return true
                const parsed = richTextSchema.safeParse(transaction.doc.toJSON())
                const accepted =
                  parsed.success && richTextToText(parsed.data).length <= current.current.maxLength
                setFeedback(
                  accepted
                    ? ''
                    : parsed.success
                      ? `Text exceeds ${current.current.maxLength.toLocaleString()} characters. Shorten the text before inserting it.`
                      : 'Text exceeds the supported formatting or nesting limits.',
                )
                return accepted
              },
            }),
          ]
        },
      }),
    [],
  )
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        code: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
        strike: false,
        underline: false,
        trailingNode: false,
        link: {
          openOnClick: false,
          autolink: false,
          linkOnPaste: false,
          isAllowedUri: isRichTextHref,
        },
      }),
      bounds,
    ],
    content: richTextDocument(value),
    editable: !disabled,
    onUpdate: ({ editor: updated }) =>
      current.current.onChange(richTextSchema.parse(updated.getJSON())),
  })
  const attributesJson = JSON.stringify({
    role: 'textbox',
    'aria-multiline': 'true',
    ...(control.id ? { id: control.id } : {}),
    ...Object.fromEntries(
      Object.entries(control)
        .filter(([key, entry]) => key.startsWith('aria-') && entry !== undefined)
        .map(([key, entry]) => [key, String(entry)]),
    ),
    'aria-describedby': [control['aria-describedby'], feedback ? feedbackId : '']
      .filter(Boolean)
      .join(' '),
    'aria-disabled': String(Boolean(control.disabled)),
    'aria-readonly': String(disabled),
  })
  useEffect(() => {
    if (!editor) return
    const next = richTextDocument(value)
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(next)) {
      editor.chain().setMeta('addToHistory', false).setContent(next, { emitUpdate: false }).run()
      // A remote revision or parent Undo owns its own history. Local typing Undo must not
      // resurrect content from before that replacement.
      editor.view.updateState(
        EditorState.create({
          schema: editor.schema,
          doc: editor.state.doc,
          selection: editor.state.selection,
          plugins: editor.state.plugins,
        }),
      )
    }
  }, [editor, value])
  useEffect(() => {
    if (!editor) return
    editor.setEditable(!disabled, false)
    editor.setOptions({
      editorProps: {
        attributes: {
          ...(JSON.parse(attributesJson) as Record<string, string>),
          class: cn(
            'min-h-24 max-h-64 overflow-y-auto px-2 py-2 text-xs/relaxed whitespace-pre-wrap [&_p+p]:mt-2 [&_ul]:list-disc [&_ol]:list-decimal [&_li]:ml-5 [&_a]:underline',
            CONTROL_FOCUS_VISIBLE,
          ),
        },
      },
    })
  }, [editor, disabled, attributesJson])
  return (
    <div
      data-slot="rich-text-editor"
      className={cn(FIELD_SURFACE, CONTROL_INVALID, className)}
      aria-invalid={control['aria-invalid']}
    >
      {editor && <RichTextToolbar editor={editor} disabled={disabled} />}
      <EditorContent editor={editor} />
      {feedback && (
        <p id={feedbackId} role="alert" className="px-2 pb-2 text-xs text-status-error">
          {feedback}
        </p>
      )}
    </div>
  )
}
