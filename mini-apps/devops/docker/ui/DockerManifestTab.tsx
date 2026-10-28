import { useCallback, useMemo, useState } from 'react'
import { Play, Hammer, ArrowUpCircle, ArrowDownCircle, ListTree, ScrollText } from 'lucide-react'
import { FileTab } from '@localixai/mini-app-sdk/ui/components'
import { Button } from '@localixai/kit/button'
import { Field } from '@localixai/kit/field'
import { Input } from '@localixai/kit/input'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@localixai/kit/dialog'
import { WorkbenchToolbar } from '@localixai/kit/workbench-toolbar'
import {
  buildComposeCommand,
  buildDockerBuildCommand,
  baseName,
  defaultBuildTag,
  detectManifestKind,
  type ComposeAction,
  type DockerManifestKind,
} from './model/dockerManifestCommands'
import { focusOnMount } from '../../ui/focusOnMount'
import { spawnInTerminal } from './model/terminalSpawn'

/**
 * A Dockerfile / Compose manifest open in the code editor, upgraded with a Run bar —
 * the same pattern as the `.sql` editor integration: the ordinary editable FileTab PLUS
 * a docked action bar that spawns the matching `docker …` command in the workspace
 * terminal (build / up / down / ps / logs). Contributed to the editor-grid's file-type
 * editor registry from this mini app's `register.tsx`, so core routing composes
 * the inspector's FileTab with shared terminal machinery without core importing Docker.
 *
 * Spawns reuse the EXISTING terminal PTY + editor-grid terminal tab via
 * `spawnInTerminal` (the same path as `docker exec` into a container).
 */
export function DockerManifestTab(props: React.ComponentProps<typeof FileTab>) {
  const { path, sessionId } = props
  const kind = detectManifestKind(path) as DockerManifestKind // registry only routes here for a real manifest
  const fileName = baseName(path)

  // The editor's own chat (the host's `sessionId` prop), so a Run lands in the terminal of the
  // chat this manifest is open in — not whichever chat is on screen when the button is pressed.
  const run = useCallback(
    (command: string, title: string) => void spawnInTerminal(sessionId, command, title),
    [sessionId],
  )

  const bottomPanel = useMemo(
    () =>
      kind === 'dockerfile' ? (
        <DockerfileBar path={path} fileName={fileName} onBuild={run} />
      ) : (
        <ComposeBar path={path} fileName={fileName} onRun={run} />
      ),
    [kind, path, fileName, run],
  )

  return <FileTab {...props} bottomPanel={bottomPanel} />
}

/** The action bar shown under a Dockerfile: a Build button + a tag dialog. */
function DockerfileBar({
  path,
  fileName,
  onBuild,
}: {
  path: string
  fileName: string
  onBuild: (command: string, title: string) => void
}) {
  const [tagOpen, setTagOpen] = useState(false)
  const [tag, setTag] = useState('')

  const openTagDialog = useCallback(() => {
    setTag(defaultBuildTag(path))
    setTagOpen(true)
  }, [path])

  const confirmBuild = useCallback(() => {
    const t = tag.trim()
    if (!t) return
    onBuild(buildDockerBuildCommand(path, t), `build: ${t}`)
    setTagOpen(false)
  }, [tag, path, onBuild])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WorkbenchToolbar aria-label="Dockerfile actions">
        <Button size="sm" variant="mono" onClick={openTagDialog}>
          <Hammer /> Build image
        </Button>
        <span className="truncate text-2xs text-text-faint">{fileName} · docker build</span>
      </WorkbenchToolbar>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 py-2 text-2xs leading-relaxed text-text-faint">
        Build a Docker image from this Dockerfile. The build context is the file&apos;s directory.
        The command runs in a terminal tab so you can watch its output.
      </div>

      <Dialog open={tagOpen} onOpenChange={setTagOpen}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Build image</DialogTitle>
          </DialogHeader>
          <DialogBody>
            <Field label="Image tag">
              <Input
                ref={focusOnMount}
                value={tag}
                onChange={(e) => setTag(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmBuild()
                }}
                placeholder="my-image:latest"
              />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button size="sm" variant="ghost" onClick={() => setTagOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="mono" disabled={!tag.trim()} onClick={confirmBuild}>
              <Hammer /> Build
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

const COMPOSE_ACTIONS: {
  action: ComposeAction
  label: string
  icon: React.ReactNode
  title: string
}[] = [
  { action: 'up', label: 'Up', icon: <ArrowUpCircle />, title: 'Start services (up -d)' },
  {
    action: 'down',
    label: 'Down',
    icon: <ArrowDownCircle />,
    title: 'Stop and remove services (down)',
  },
  { action: 'ps', label: 'Ps', icon: <ListTree />, title: 'List services (ps)' },
  { action: 'logs', label: 'Logs', icon: <ScrollText />, title: 'Follow logs (logs -f)' },
  { action: 'build', label: 'Build', icon: <Hammer />, title: 'Build services (build)' },
]

/** The action bar shown under a Compose manifest: up / down / ps / logs / build. */
function ComposeBar({
  path,
  fileName,
  onRun,
}: {
  path: string
  fileName: string
  onRun: (command: string, title: string) => void
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <WorkbenchToolbar wrap aria-label="Docker Compose actions" className="gap-1.5">
        {COMPOSE_ACTIONS.map(({ action, label, icon, title }) => (
          <Button
            key={action}
            size="sm"
            variant={action === 'up' ? 'mono' : 'ghost'}
            title={title}
            onClick={() =>
              onRun(buildComposeCommand(path, action), `compose ${action}: ${fileName}`)
            }
          >
            {icon} {label}
          </Button>
        ))}
      </WorkbenchToolbar>
      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 py-2 text-2xs leading-relaxed text-text-faint">
        Run Docker Compose against <span className="text-text-soft">{fileName}</span>. Each action
        opens a terminal tab so you can watch its output.{' '}
        <span className="inline-flex items-center gap-1">
          <Play className="size-2.5" /> Up
        </span>{' '}
        starts detached (<code>up -d</code>).
      </div>
    </div>
  )
}
