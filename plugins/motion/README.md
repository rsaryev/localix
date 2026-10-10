# Motion Studio

Bundled Localix plugin for motion films authored as code. A film is a
[HyperFrames](https://hyperframes.heygen.com) project (HTML, CSS, GSAP; Apache-2.0) in the
conversation workspace, `.localix/motion/<id>/`, so the agent writes and revises it with ordinary
file tools and every frame is deterministic.

- `directions/<id>/` — eleven hand-made sample films (Blackout, Relay, Nightfall, Orbit, Type play,
  Daylight, Connect, Momentum, Soft signal, Offbeat, Field notes). `create` forks one; `restyle`
  applies another's tokens and rules (`shared/styles.ts`) to an existing film.
- `kit/` — the Localix motion kit copied into every film: `motion-kit.css` (tokens, components),
  `motion-kit.js` (seek-safe GSAP helpers) and `AGENTS.md` (the contract the agent follows).
- `backend/` — project files, static checks (`lint.ts`), HyperFrames CLI jobs for review stills and
  renders (`jobs.ts`), signed view URLs for the isolated player (`view.ts`), the `motion_studio`
  tool and routes.
- `ui/` — films list, direction gallery and preview, film view with `@hyperframes/player`.
- `skills/create-motion/` — the agent workflow and craft reference.

See the [user guide](../../docs/features/motion-studio.md) and [source research](REFERENCE.md).

```bash
bun run --cwd plugins/motion dev                 # standalone preview on 5184/5185
bun test plugins/motion
bun run --cwd plugins/motion type-check
bun scripts/try-direction.ts <direction> <workspace>   # assemble a direction as a fork (from plugins/motion)
bun run --cwd plugins/motion previews            # regenerate gallery stills (needs Node 22+, FFmpeg)
```

Review stills and renders run the pinned HyperFrames CLI (`npx hyperframes@0.8.143`), which needs
Node.js 22+ and FFmpeg on the login PATH and downloads Chrome on first use. Compositions load GSAP
from its CDN; GSAP is not redistributed with this plugin.
