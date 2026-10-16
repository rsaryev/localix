import { GitPullRequestArrow } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@localixai/kit/popover'
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from '@localixai/kit/command'
import { useState } from 'react'
import { mindBranch } from '../../shared/types/mindmap-ops'
import type { MindNode } from '../../shared/types/mindmap-text'

export function MindmapParent({
  nodes,
  id,
  onPick,
}: {
  nodes: MindNode[]
  id: string
  onPick: (parent: string) => void
}) {
  const [open, setOpen] = useState(false)
  const excluded = mindBranch(nodes, id)
  const current = nodes.find((node) => node.id === id)?.parent
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton
          size="xs"
          disabled={!current}
          aria-label="Move branch"
          tooltip="Move branch to another idea"
        >
          <GitPullRequestArrow className="size-3.5" />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="end" aria-label="Choose parent idea">
        <Command>
          <CommandInput placeholder="Find parent idea…" />
          <CommandList>
            <CommandEmpty>No matching ideas.</CommandEmpty>
            {nodes
              .filter((node) => !excluded.has(node.id))
              .map((node) => (
                <CommandItem
                  key={node.id}
                  value={`${node.text} ${node.id}`}
                  aria-selected={current === node.id}
                  onSelect={() => {
                    onPick(node.id)
                    setOpen(false)
                  }}
                >
                  {node.text}
                </CommandItem>
              ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
