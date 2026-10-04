---
description: Adapt one lesson in the current Learning Studio course
---

Adapt $ARGUMENTS in the attached Learning Studio course. Use learning_course action get with a
focused lesson_id or step_id to inspect content and learner evidence. Use action guide if needed.
Patch only affected files in the canonical bundle returned as manifest_path, then validate and
activate the same root course.json. Preserve stable ids and unrelated material. Changing a quiz,
practice task or recall cards invalidates its earlier evidence; polishing theory preserves progress.
