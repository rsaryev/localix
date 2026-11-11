import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@localixai/kit/dialog'
import { closeSetup } from '@/shared/lib/setupDialog'
import { WorkspaceTipsCarousel } from './WorkspaceTipsCarousel'

/**
 * Setup, in a dialog over the chat the launch opened: the workspace tips, each with its scene and,
 * where a choice is made, the control itself. Bounded like every dialog; on a short window the
 * body scrolls and the header stays. Any way of closing it ends setup.
 */
export default function SetupDialog() {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeSetup()
      }}
    >
      <DialogContent size="xl" className="max-h-[min(46rem,calc(100dvh-2rem))]">
        <DialogHeader className="text-center [&>[data-slot=dialog-header-main]]:items-center pl-10">
          <DialogTitle>Set up Localix</DialogTitle>
          <DialogDescription className="text-balance">
            A few choices and how things work. Open it again from the command palette: Set up
            Localix.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="pt-2 pb-5">
          <WorkspaceTipsCarousel onFinish={closeSetup} />
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
