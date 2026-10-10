# Motion Studio

## Purpose

Localix users and their agents make short motion films together: landing heroes, product launches
with real screenshots, kinetic type, logo stings, event posters, data stories. The agent is the
author; the view is for choosing a direction, watching, reviewing and rendering.

## Flow

The empty library is one centred **+**. **+** opens a gallery of directions — complete sample films
that play on hover. A direction opens large with **Use direction**, which forks it into the
workspace and opens the film. The person then describes the story in chat; the agent rewrites the
film, checks it, reviews stills and renders on request. Films are listed when they exist, with **+**
in the toolbar.

## Constraints

Use the host kit and tokens. No forms for authoring: changes happen in chat. Agent-authored HTML
runs in an isolated player (opaque origin, signed file URLs). Everything rendered must be
deterministic. Do not invent claims or figures in sample films; mark sample lines with
`data-sample`.
