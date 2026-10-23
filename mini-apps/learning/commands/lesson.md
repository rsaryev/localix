---
description: Generate one pending lesson from the current course outline
---

Prepare lesson $ARGUMENTS in the attached Learning Studio course. Use learning_course action get for
the course and lesson and action guide for the exact format. Inspect earlier learner attempts and
reviews. Edit only this lesson in the canonical bundle returned as manifest_path, then validate and
activate the same course. Preserve stable ids and unrelated content. Preparing a lesson does not
complete it. Normal study requests whole modules through the tutor-generation flow; this command is
for an explicit request to work on a particular lesson.
