import { Button } from '@localixai/kit/button'
import { Input } from '@localixai/kit/input'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@localixai/kit/dialog'
import { focusOnMount } from './focusOnMount'

/** Name a folder under `folderParent` (`''` is the collection root; `null` keeps it closed). */
export function NewFolderDialog({
  folderParent,
  setFolderParent,
  folderName,
  setFolderName,
  creating,
  createFolder,
}: {
  folderParent: string | null
  setFolderParent: (parent: string | null) => void
  folderName: string
  setFolderName: (name: string) => void
  creating: boolean
  createFolder: () => void
}) {
  return (
    <Dialog
      open={folderParent !== null}
      onOpenChange={(open) => {
        if (!open) {
          setFolderParent(null)
          setFolderName('')
        }
      }}
    >
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>New folder</DialogTitle>
          <DialogDescription>
            {folderParent ? `Inside “${folderParent}”.` : 'Create a folder in this collection.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Input
            ref={focusOnMount}
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && folderName.trim()) createFolder()
            }}
            placeholder="users"
            aria-label="Folder name"
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setFolderParent(null)}>
            Cancel
          </Button>
          <Button disabled={creating || !folderName.trim()} onClick={createFolder}>
            Create folder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
