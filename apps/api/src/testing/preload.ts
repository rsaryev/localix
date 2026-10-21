// apps/api test preload. The bash tool and the plugin hosts run in ~/.localix/workspace when given
// no directory. The app creates it on first launch, so a developer machine has it and a clean CI
// runner does not; without this, every such test fails there with ENOENT from posix_spawn.
import { mkdirSync } from 'node:fs'

import { localixWorkspaceDir } from '../lib/env'

mkdirSync(localixWorkspaceDir(), { recursive: true })
