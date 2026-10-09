# Motion Studio

Bundled Localix plugin for original motion films: eleven editable motion directions and a blank
canvas, scene editing, keyframed layers, images and audio, frame-driven playback and local MP4/WebM
export. The `motion_studio` agent tool shares the same versioned projects with the user editor.
Projects and assets live in the current conversation workspace: `.localix/motion/library.json` and
`.localix/motion/assets/`, using the same workspace resolution as Resumes. Store writes push changes
to open views.

Open **All tools → Motion Studio**. See the [user guide](../../docs/features/motion-studio.md),
[source research](REFERENCE.md) and [agent skill](skills/create-motion/SKILL.md).

```bash
bun run --cwd plugins/motion dev
bun test plugins/motion/backend plugins/motion/shared
bun run --cwd plugins/motion type-check
```

The standalone preview uses its own data and loopback ports 5184/5185. It has no account or model
credentials. The UI takes all controls and chrome from the host kit. Film palettes are document
content, independent of the workbench theme. MP4/WebM exports use Mediabunny (MPL-2.0) and browser
codecs; no external template source, font, soundtrack or reference film is redistributed.
