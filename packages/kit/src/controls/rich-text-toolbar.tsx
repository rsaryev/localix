import { useState } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { Bold, Italic, Link, List, ListOrdered, Unlink } from 'lucide-react'
import { isRichTextHref } from '@localixai/plugin-sdk/rich-text'
import { IconButton } from './icon-button'
import { Button } from './button'
import { Input } from './input'
import { Field } from './field'

export function RichTextToolbar({ editor, disabled }: { editor: Editor; disabled: boolean }) {
  const [linkOpen, setLinkOpen] = useState(false)
  const [href, setHref] = useState('')
  const active = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive('bold'),
      italic: current.isActive('italic'),
      bullet: current.isActive('bulletList'),
      ordered: current.isActive('orderedList'),
      link: current.isActive('link'),
    }),
  })
  const commands = [
    {
      label: 'Bold',
      icon: Bold,
      pressed: active.bold,
      run: () => editor.chain().focus().toggleBold().run(),
    },
    {
      label: 'Italic',
      icon: Italic,
      pressed: active.italic,
      run: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      label: 'Bullet list',
      icon: List,
      pressed: active.bullet,
      run: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      label: 'Numbered list',
      icon: ListOrdered,
      pressed: active.ordered,
      run: () => editor.chain().focus().toggleOrderedList().run(),
    },
  ]
  return (
    <div className="space-y-2 border-b border-border p-1">
      <div role="group" aria-label="Text formatting" className="flex flex-wrap gap-1">
        {commands.map(({ label, icon: Icon, pressed, run }) => (
          <IconButton
            key={label}
            size="sm"
            aria-label={label}
            aria-pressed={pressed}
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={run}
          >
            <Icon />
          </IconButton>
        ))}
        <IconButton
          size="sm"
          aria-label="Edit text link"
          aria-expanded={linkOpen}
          aria-pressed={active.link}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setHref(editor.getAttributes('link').href ?? '')
            setLinkOpen(!linkOpen)
          }}
        >
          <Link />
        </IconButton>
        <IconButton
          size="sm"
          aria-label="Remove text link"
          disabled={disabled || !active.link}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => editor.chain().focus().extendMarkRange('link').unsetLink().run()}
        >
          <Unlink />
        </IconButton>
      </div>
      {linkOpen && (
        <div className="flex flex-wrap items-end gap-2 p-1">
          <Field
            label="Text link URL"
            className="min-w-0 flex-1"
            error={
              href && !isRichTextHref(href)
                ? 'Use an HTTP, HTTPS, email or telephone link'
                : undefined
            }
          >
            <Input
              value={href}
              maxLength={2_000}
              placeholder="https://example.com"
              disabled={disabled}
              onChange={(event) => setHref(event.target.value)}
            />
          </Field>
          <Button
            size="sm"
            disabled={disabled || !isRichTextHref(href)}
            onClick={() => {
              editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
              setLinkOpen(false)
            }}
          >
            Apply link
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setLinkOpen(false)
              editor.commands.focus()
            }}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}
