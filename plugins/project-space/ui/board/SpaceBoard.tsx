import { useRef, useState } from 'react'
import { Canvas, useCanvasCamera } from '@localixai/kit/canvas'
import { useNativeEditTarget } from '@localixai/kit/keybindings'
import type { SpaceView } from '../../shared/api'
import type { SpaceOp } from '../../shared/ops/contract'
import { Announcer, namesOf, useAnnouncer, useBoardAnnouncements } from './Announcer'
import { BoardMenu, useBoardMenu } from './BoardMenu'
import { BoardOverlay, groupOutlines } from './BoardOverlay'
import { boardKeyHandler } from './boardKeys'
import { BoardContext } from './context'
import { useElementActions, useElementEditing, usePublishBoardSelection } from './useElementEditing'
import { copyBoardImage } from './copyImage'
import { DetailDepth } from './DetailDepth'
import { EdgeBar } from './EdgeBar'
import { ElementNode } from './ElementNode'
import { isElementControl } from './interaction'
import { FindDialog } from './FindDialog'
import { LayersPanel } from './LayersPanel'
import { frameSelection } from './frameSelection'
import type { MenuContext } from './menuItems'
import { PresentBar } from './PresentBar'
import { ToolLayer } from './ToolLayer'
import { SelectionBar } from './SelectionBar'
import { ShortcutsDialog } from './ShortcutsDialog'
import { ELEMENT_NODE, type ElementNode as ElementNodeType } from './toFlow'
import { ToolRail } from './ToolRail'
import { TraceChip, traceSummary } from './TraceChip'
import { useBoardIO } from './useBoardIO'
import { useCreate } from './useCreate'
import { CameraChips } from '../camera/CameraChips'
import { useBoardCamera } from '../camera/useBoardCamera'
import type { RemoteChange } from '../useSpace'
import { useLiveBoard } from './useLiveBoard'
import { useReading, useReadingFlow } from './useReading'
import { usePresentation, useSlide } from './usePresentation'
import { useRenderWindow } from './useRenderWindow'
import { useStyleClipboard } from './useStyleClipboard'
import { useTools } from './useTools'
import { ZoomVar } from './ZoomVar'

/** Shared Canvas gestures and board operations. `data-osfile-attach` keeps OS drops on this board
 * instead of letting the host open the files; reading overlays share selection and geometry. */
const nodeTypes = { [ELEMENT_NODE]: ElementNode }

export interface SpaceBoardProps {
  view: SpaceView
  sessionId: string
  apply: (ops: readonly SpaceOp[]) => void
  undo: () => void
  redo: () => void
  onSelection: (ids: readonly string[]) => void
  /** What changed on the board that the person did not do — what the camera can follow. */
  remote: RemoteChange | null
}

export function SpaceBoard({
  view,
  sessionId,
  apply,
  undo,
  redo,
  onSelection,
  remote,
}: SpaceBoardProps) {
  const camera = useCanvasCamera()
  const [layers, setLayers] = useState(false)
  const [finding, setFinding] = useState(false)
  const [sheet, setSheet] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const { editing, setEditing } = useElementEditing(root)
  const space = view.space
  const board = useLiveBoard(view, apply)
  const { message, announce } = useAnnouncer()
  const boardCamera = useBoardCamera({
    root,
    sessionId,
    view,
    remote,
    selected: board.selected,
    select: board.select,
    still: { busy: board.busy, editing },
    onAgentShown: (ids) => announce(`Showing ${namesOf(space, ids)}.`),
  })
  const reading = useReading(space, board.selected, boardCamera.reveal)
  const flow = useReadingFlow(board.nodes, board.edges, reading.lit)
  const trace = traceSummary(space, reading)
  useBoardAnnouncements(space, remote, trace, announce)
  const io = useBoardIO({ sessionId, space, selected: board.selected, commit: board.commit })
  const tools = useTools({ space, commit: board.commit, select: board.select, setEditing })
  const create = useCreate({ space, commit: board.commit, select: board.select, setEditing })

  usePublishBoardSelection(board.selected, onSelection)

  const { actions, selectedElements, selectedEdge } = useElementActions({
    sessionId,
    apply: board.commit,
    grow: create.grow,
    focus: (id) => boardCamera.focusOn([id]),
    setEditing,
    editing,
    selected: board.selected,
    space,
  })
  const styleClipboard = useStyleClipboard()
  const present = usePresentation(space, boardCamera.director, board.select)
  const scene = useSlide(flow, present.slide)
  const renderWindow = useRenderWindow(board.nodes.length)
  const unlocked = () => Object.keys(space.elements).filter((id) => !space.elements[id]?.locked)
  const onBoardKey = boardKeyHandler({
    space,
    selected: board.selected,
    entered: board.entered,
    select: board.select,
    focus: boardCamera.focusOn,
    enterGroup: board.enterGroup,
    leaveGroup: board.leaveGroup,
    commit: board.commit,
    undo,
    redo,
    setEditing,
    onToolKey: tools.onToolKey,
    toggleLayers: () => setLayers((open) => !open),
    openFind: () => setFinding(true),
    openShortcuts: () => setSheet(true),
    clearTrace: reading.clearTrace,
    grow: create.grow,
    camera: boardCamera.keys,
    style: styleClipboard,
    presentation: present,
  })

  useNativeEditTarget(root, (command) => {
    if (command === 'undo') undo()
    else if (command === 'redo') redo()
    else board.select(unlocked())
  })

  const menu = useBoardMenu(root, {
    space,
    selected: board.selected,
    select: board.select,
    toBoard: (x, y) => camera.toBoard(x, y),
  })
  const image = (mode: 'copy' | 'save') => (ids: readonly string[]) =>
    copyBoardImage(root.current, space, ids, renderWindow.drawAll, mode)
  const menuContext: MenuContext = {
    space,
    sessionId,
    reading,
    copyImage: image('copy'),
    saveImage: image('save'),
    edit: setEditing,
    style: styleClipboard,
    entered: board.entered,
    commit: board.commit,
    addNote: create.noteAt,
    selectAll: () => board.select(unlocked()),
    fit: () => camera.fit(),
    openFind: () => setFinding(true),
    openShortcuts: () => setSheet(true),
    frame: (ids) => frameSelection({ ...board, space, setEditing }, ids),
  }

  const outlines = groupOutlines(space, board.nodes, board.selected, board.entered)
  return (
    <BoardContext.Provider value={actions}>
      <div
        ref={root}
        data-osfile-attach
        data-tool={tools.tool}
        data-presenting={present.active || undefined}
        className="space-board relative h-full min-h-0 w-full"
        onPointerMove={io.onPointerMove}
        onPointerLeave={io.onPointerLeave}
        onDragOver={io.onDragOver}
        onDrop={io.onDrop}
        onPaste={io.onPaste}
        onCopy={io.onCopy}
        onCut={io.onCut}
      >
        <Canvas<ElementNodeType>
          label="Project Space board. Pick a tool on the left and click the board to place it; drop files, folders or text. Press / to find an element, ? for every shortcut"
          interaction={tools.tool === 'hand' ? 'navigate' : 'edit'}
          nodes={scene.nodes}
          edges={scene.edges}
          nodeTypes={nodeTypes}
          zIndexMode="manual"
          onlyRenderVisibleElements={renderWindow.windowed}
          snapZoom
          // The layers panel takes the right edge, where the minimap would sit under it.
          minimap={!layers && board.nodes.length >= 12}
          onNodesChange={board.onChanges}
          onEdgesChange={board.onEdgeChanges}
          // An armed tool places wherever it is clicked — inside a frame too, which is a node,
          // not the ground, and used to swallow the click.
          onNodeClick={(event, node) => {
            if (isElementControl(event.target)) return
            if (tools.placeAt(event.clientX, event.clientY)) return
            board.onElementClick(node.id)
            // A plain click is a focus the camera goes to; a Shift/⌘ click adds to a selection.
            if (!event.shiftKey && !event.metaKey && !event.ctrlKey) boardCamera.intend()
          }}
          onNodeDragStart={(_event, _node, nodes) => board.startDrag(nodes)}
          onNodeDragStop={board.finishDrag}
          onSelectionDragStart={(_event, nodes) => board.startDrag(nodes)}
          onSelectionDragStop={board.finishDrag}
          onConnect={(connection) => create.connect(connection.source, connection.target)}
          onConnectEnd={create.connectEnd}
          onPaneClick={(event) => {
            setEditing(null)
            tools.placeAt(event.clientX, event.clientY)
          }}
          onBoardKey={onBoardKey}
          onBoardDoubleClick={create.noteAt}
        />
        <ZoomVar target={root} />
        <DetailDepth target={root} />
        <CameraChips
          director={boardCamera.director}
          follow={boardCamera.follow}
          lead={trace ? <TraceChip space={space} reading={reading} /> : null}
        />
        <ToolLayer
          root={root}
          tools={tools}
          space={space}
          commit={board.commit}
          select={board.select}
          onBoardKey={onBoardKey}
        />
        <BoardOverlay guides={board.guides} outlines={outlines} />
        {selectedElements.length > 0 && !editing && (
          <SelectionBar
            space={space}
            ids={selectedElements}
            entered={board.entered}
            sessionId={sessionId}
            commit={board.commit}
            onEdit={setEditing}
            reading={reading}
            focus={boardCamera.focusOn}
            select={board.select}
          />
        )}
        {selectedEdge && selectedElements.length === 0 && space.edges[selectedEdge] && (
          <EdgeBar
            key={selectedEdge}
            space={space}
            id={selectedEdge}
            edge={space.edges[selectedEdge]}
            commit={board.commit}
          />
        )}
        <ToolRail
          sessionId={sessionId}
          tool={tools.tool}
          toolProps={tools.toolProps}
          locked={tools.locked}
          onTool={tools.setTool}
          onLock={() => tools.setLocked((current) => !current)}
          onAddFiles={io.addFiles}
          undo={undo}
          redo={redo}
          canUndo={view.canUndo}
          canRedo={view.canRedo}
          layersOpen={layers}
          onLayers={() => setLayers((open) => !open)}
          onFind={() => setFinding(true)}
          onShortcuts={() => setSheet(true)}
          onPresent={present.frames.length ? () => present.start(root.current) : undefined}
        />
        <PresentBar presentation={present} space={space} />
        {layers && (
          <LayersPanel
            space={space}
            selected={board.selected}
            // A row picked alone is a deliberate focus: the camera goes there. Shift/⌘ adds.
            select={(ids, add) => (add ? board.select(ids, true) : boardCamera.focusOn(ids))}
            commit={board.commit}
            onClose={() => setLayers(false)}
          />
        )}
        <BoardMenu root={root} open={menu.open} close={menu.close} context={menuContext} />
        <FindDialog
          space={space}
          open={finding}
          onOpenChange={setFinding}
          onPick={(id) => boardCamera.focusOn([id])}
          commit={board.commit}
        />
        <ShortcutsDialog open={sheet} onOpenChange={setSheet} />
        <Announcer message={message} />
      </div>
    </BoardContext.Provider>
  )
}
