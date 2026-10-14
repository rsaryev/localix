# Fix a UI bug by pointing at it

Visual Feedback captures a selected preview element with DOM, style, screenshot, and source hints.
Use it when a visible defect is easier to point at than to describe from memory.

**Requires:** Open the page in a probe-connected Localix preview. Arbitrary browser tabs and desktop
windows are outside this workflow.

## What you can do

| Outcome                | Mechanism                                                                      | Boundary                                                                   |
| ---------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| Describe one element   | Pick it and save a note with its capture and optional JPEG.                    | Source resolution and screenshot rasterization are best-effort.            |
| Reproduce a breakpoint | Pin the preview iframe to a named CSS viewport and rotate it.                  | This does not emulate a device, browser, or touch input.                   |
| Mark empty space       | Drag a region and record its viewport coordinates.                             | A region has no element selector or source line.                           |
| Add selected text      | Select text while Visual Feedback is on; it attaches to the draft immediately. | No note card or screenshot is created; the selected words are the comment. |
| Batch related defects  | Save several comments; each lands in the composer's attached context.          | Attaching to the composer does not send the message.                       |

The [Visual Feedback guide](../features/visual-feedback.md) owns probe injection, source resolution,
redaction, and screenshot behavior. This recipe covers the shortest fix-and-verify path.

## How it works

### 1. Open the failing page in Preview

Start the application or static page, then open its URL in a Localix preview pane. Wait for the page
to render before turning on Visual Feedback.

You should see the page inside the workspace and an enabled **Visual Feedback** control. A disabled
control means the probe is not connected and no injectable proxy is available.

### 2. Match the failing viewport

Use **Page frame size** to choose the relevant width and height. Use **Rotate frame** when the same
preset needs the opposite orientation.

You should see the iframe adopt the displayed CSS dimensions. For example, **iPhone SE** is 375 ×
667 CSS pixels; the control changes layout size rather than device identity.

### 3. Pick the defective element

Turn on **Visual Feedback**, then click the element. Enter a short observation such as “extra space
below this label,” keep or remove the staged screenshot, and choose **Attach feedback**.

You should see a quiet tint on the commented element and one attached-context entry in the session
composer. Expand that entry to review the note and any screenshot. There are no numbered pins. The
capture can include a selector, DOM path, text, role, compact computed styles, rectangle, component
ancestry, and best-effort source location. The note is optional: an empty note attaches a short
observation about the selected element, even if screenshot capture failed.

### 4. Review the attached context, then send

Pick more elements, or drag a region for empty space. Each observation attaches directly to the
session's draft as a context binding.

Review the context entries and image attachments in the session composer, add your instructions,
then send. Attaching feedback does not start an agent turn or change your message text.

### 5. Apply and verify the change

Ask the agent to make the smallest change that addresses the captured evidence. After the preview
reloads, reproduce the same viewport and pick the element again.

You should see the corrected layout in the same CSS dimensions. Re-capturing the element also lets
you compare its current DOM and style context with the original note.

## Configuration

| Control             | Effect                                                      | Availability                                                   |
| ------------------- | ----------------------------------------------------------- | -------------------------------------------------------------- |
| **Visual Feedback** | Enables element, text, multi-element, and region selection. | Requires a connected or injectable preview probe.              |
| **Page frame size** | Selects responsive fill or a fixed CSS viewport.            | Available in the browser toolbar.                              |
| **Rotate frame**    | Swaps a fixed preset's width and height.                    | Hidden for responsive fill.                                    |
| **Attach feedback** | Attaches an observation and its images to draft context.    | Requires a selected capture and session; the note is optional. |

## Limits

- Source mapping is best-effort. Production bundles and non-React pages may provide no line number;
  a Localix-served static file can supply only a file-level fallback.
- Text selection attaches up to 500 UTF-16 code units from the selected words. Select a smaller
  passage or attach the source document when the omitted text matters.
- Element screenshots re-render DOM through a canvas path. Cross-origin images can be omitted, and
  rasterization can fail.
- A fixed viewport does not emulate user agent, device pixel ratio, touch, sensors, or a specific
  browser engine.
- If picking is unavailable, reload the preview and confirm **Visual Feedback** becomes enabled. If
  the page remains viewable but the control stays disabled, use a Localix static preview or the
  injecting proxy with a trusted origin.
- If a capture has no source location, send the selector, screenshot, and visible description, then
  let the agent search the project. Do not treat a guessed file as mapped evidence.

## Related guides

- [Annotate a live preview](../features/visual-feedback.md)
- [Use the workspace](../features/workspace.md)

## Source of truth

- [Probe capture](https://github.com/rsaryev/localix/blob/main/packages/visual-feedback/src/probe/capture.ts)
- [Source resolution](https://github.com/rsaryev/localix/blob/main/packages/visual-feedback/src/source/index.ts)
- [Host bridge](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/inspector/ui/useVisualFeedback.ts)
- [Comment batching](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/inspector/ui/VisualFeedbackLayer.tsx)
- [Viewport presets](https://github.com/rsaryev/localix/blob/main/apps/ui/src/features/inspector/model/previewViewportPresets.ts)
