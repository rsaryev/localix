import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { pluginExternal } from '@localixai/mini-app-sdk/ui/runtime'
import { Button } from '@localixai/kit/button'
import { Input } from '@localixai/kit/input'
import { Popover, PopoverContent, PopoverTrigger } from '@localixai/kit/popover'
import { asWebUrl, webLinksInText } from '../../shared/content/text'

export function WebLink({ url, children }: { url: string; children: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="nodrag inline cursor-pointer break-all text-inherit underline decoration-current/60 underline-offset-2 hover:decoration-current focus-visible:outline focus-visible:outline-ring"
          aria-label={`Link options: ${children}`}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="nodrag w-80 p-3"
        sideOffset={8}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <span className="block break-all text-xs text-text-soft">{url}</span>
        <Button size="sm" className="mt-2" onClick={() => void pluginExternal.open(url)}>
          <ExternalLink className="size-3.5" /> Open website
        </Button>
      </PopoverContent>
    </Popover>
  )
}

export function LinkedText({ text }: { text: string }) {
  let end = 0
  const parts = webLinksInText(text).flatMap((link) => {
    const before = text.slice(end, link.start)
    end = link.end
    return [
      before,
      <WebLink key={link.start} url={link.url}>
        {link.text}
      </WebLink>,
    ]
  })
  return (
    <>
      {parts}
      {text.slice(end)}
    </>
  )
}

/** One form for adding and editing web cards, using the same URL validation as paste. */
export function LinkForm({
  url = '',
  title = '',
  onSave,
  onCancel,
}: {
  url?: string
  title?: string
  onSave: (props: { url: string; title: string }) => void
  onCancel: () => void
}) {
  const [address, setAddress] = useState(url)
  const [name, setName] = useState(title)
  const valid = asWebUrl(address)
  return (
    <form
      className="nodrag flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (valid) onSave({ url: valid, title: name.trim() })
      }}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Escape') {
          event.preventDefault()
          onCancel()
        }
      }}
    >
      <label className="flex flex-col gap-1.5 text-xs font-medium">
        Website URL
        <Input
          autoFocus
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="https://example.com"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-xs font-medium">
        Title (optional)
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Website name"
        />
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={!valid}>
          Save link
        </Button>
      </div>
    </form>
  )
}
