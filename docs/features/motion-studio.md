# Motion Studio

Motion Studio makes short motion films with the agent: landing-page heroes, product launches with
your screenshots, kinetic type, logo stings, event posters and data stories. A film is code — an
[HyperFrames](https://hyperframes.heygen.com) composition of HTML, CSS and GSAP — so the agent
writes and revises it like any other file, and every frame renders the same in preview and export.

Open **All tools → Motion Studio**. With no films, the view shows one **+** action; otherwise it
lists the conversation's films, with **+** in the toolbar.

## Start from a direction

**+** opens the directions. Each direction is a complete sample film with its own idea, layout, type
and motion: Blackout, Relay, Nightfall, Orbit, Type play, Daylight, Connect, Momentum, Soft signal,
Offbeat and Field notes. Hover a tile to play it; select it to watch the film large.

**Use direction** copies that film into your workspace and opens it. Then tell the agent in chat
what the film is about, and attach or point to your logo, screenshots and music. The agent keeps the
direction's choreography, replaces every sample line and adds or removes scenes. You can also skip
the gallery and just describe the film in chat; the agent picks a direction itself.

## Work with the agent

Each film is a folder in the conversation's workspace:

```text
.localix/motion/<film>/index.html          the timeline: scenes and transitions
.localix/motion/<film>/compositions/*.html one file per scene
.localix/motion/<film>/blocks/             motion kit and the direction's tokens
.localix/motion/<film>/DIRECTION.md        the direction's rules
.localix/motion/<film>/assets/             your logo, screenshots, video, audio
```

The agent edits these files with its ordinary tools and uses `motion_studio` to import media, check
the composition, take review stills and render. The check reports broken timing, missing files,
non-deterministic code and sample lines that are still on screen. The agent looks at its stills
before it hands a film back, and those stills appear under **Review stills**.

The preview reloads whenever a file changes. Ask for changes in chat — "make the hook shorter", "use
our real dashboard screenshot", "switch to the Field notes direction" — rather than editing in the
view. Open a film to attach it to your next message.

## Render

**Render** writes an MP4 or WebM into the film's `renders/` folder at draft, standard or high
quality. Progress shows above the preview and can be cancelled. Finished renders are listed beside
the preview: play one in place or download it.

Rendering and review stills run the HyperFrames CLI, which needs Node.js 22 or newer and FFmpeg on
your PATH and downloads a headless Chrome the first time. Without them, the preview still works and
the view explains what to install.

## Films from earlier versions

Projects created by the earlier scene editor (`library.json` or `motion.json`) are not opened by
this version. Ask the agent to rebuild one as a new film from its copy and timing.
