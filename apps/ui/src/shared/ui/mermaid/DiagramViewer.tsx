import { useMemo, type ReactNode } from 'react'
import { Dialog, DialogContent, DialogTitle } from '@localixai/kit/dialog'
import {
  Canvas,
  CanvasControls,
  CanvasProvider,
  readableViewport,
  type Node,
  type NodeProps,
} from '@localixai/kit/canvas'
import { diagramBounds, diagramWindowSize } from './diagramGeometry'

type DiagramNode = Node<{ svg: string }, 'diagram'>

function DiagramImage({ data }: NodeProps<DiagramNode>) {
  return (
    <div
      role="img"
      aria-label="Diagram"
      className="size-full [&>svg]:h-full [&>svg]:w-full"
      // Reuse the renderer's strict SVG. The viewer never renders source a second time.
      dangerouslySetInnerHTML={{ __html: data.svg }}
    />
  )
}

const nodeTypes = { diagram: DiagramImage }

function DiagramBoard({ svg, bounds }: { svg: string; bounds: ReturnType<typeof diagramBounds> }) {
  const nodes = useMemo<DiagramNode[]>(
    () => [
      {
        id: 'diagram',
        type: 'diagram',
        position: { x: 0, y: 0 },
        width: bounds.width,
        height: bounds.height,
        data: { svg },
        draggable: false,
        selectable: false,
        focusable: false,
      },
    ],
    [svg, bounds],
  )
  const initialViewport = useMemo(() => {
    const preferred = diagramWindowSize(bounds)
    const size = {
      width: Math.min(window.innerWidth * 0.94, preferred.width),
      height: Math.min(window.innerHeight * 0.86, preferred.height),
    }
    // Supply the first viewport before mounting: no hidden board waiting for a second layout.
    return readableViewport(bounds, size, {
      maxZoom: 1.25,
      padding: 0.06,
      readingZoom: 1,
      readableZoom: 0.7,
      anchor: {
        x: Math.min(bounds.width / 2, size.width / 2 - 32),
        y: Math.min(bounds.height / 2, size.height / 2 - 32),
      },
    })
  }, [bounds])
  return (
    <Canvas
      label="Diagram viewer"
      nodes={nodes}
      edges={[]}
      nodeTypes={nodeTypes}
      defaultViewport={initialViewport}
      background={false}
      className="transition-none"
      controls={false}
      overlay={<CanvasControls interaction="navigate" showHint={false} />}
    />
  )
}

/** The same camera and gestures as the app's graphs, in the shared accessible media dialog. */
export default function DiagramViewer({
  svg,
  onClose,
  returnFocus,
  actions,
}: {
  svg: string
  onClose: () => void
  returnFocus: () => void
  actions?: ReactNode
}) {
  const bounds = useMemo(() => diagramBounds(svg), [svg])
  const preferred = diagramWindowSize(bounds)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        size="fit"
        layout="edge-to-edge"
        appearance="media"
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          returnFocus()
        }}
      >
        <div
          className="flex flex-col"
          style={{
            width: `min(94vw, ${preferred.width}px)`,
            height: `min(86dvh, ${preferred.height}px)`,
          }}
        >
          <DialogTitle className="sr-only">Diagram</DialogTitle>
          <div className="absolute top-2 right-11 z-(--z-raised) flex items-center gap-0.5">
            {actions}
          </div>
          <div className="min-h-0 flex-1">
            <CanvasProvider key={svg}>
              <DiagramBoard svg={svg} bounds={bounds} />
            </CanvasProvider>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
