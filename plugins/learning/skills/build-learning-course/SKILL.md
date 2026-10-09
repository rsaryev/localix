---
name: build-learning-course
description:
  Build, continue or adapt a Learning Studio course when the learner requests a guided course or
  curriculum. Ordinary questions do not require a course.
---

# Build a useful course

Call `learning_course` with `action: "guide"` for the exact format and quality checklist. This skill
is a discoverable entry point; the tool also works directly without loading the skill.

Use the learner’s stated goal, experience, language, time and preferred depth. Ask for missing
preferences together with the host’s `ask` tool when they materially affect the route. Do not ask
again for information already supplied. Never ask whether to generate everything or progressively:
courses always prepare one complete module at a time.

Write a compact outline JSON file, then call `draft` with `outline_path` to generate the complete
pending hierarchy in one call. Author every lesson in the first module with ordinary file tools;
leave later modules pending. Long prose belongs in Markdown files. The plugin automatically asks the
tutor to prepare the next module as the learner advances, when that tutor can be reached. A failed
or missed wake is recorded as a generation failure; inspect the course and prepare the pending
module through the same authoring flow rather than treating it as ready.

Call `validate` before `activate`. Patch only the file a validation error identifies. On success,
briefly name the ready module and the course goal; the tool opens the course.

To continue or adapt, use `list` and focused `get` (`course_id`, optionally `lesson_id` /
`step_id`). Edit the canonical `manifest_path` returned by the tool, preserving stable ids and
unrelated material, then validate and activate the same course. Read learner attempts and practice
reviews before choosing difficulty. Preparing material does not complete a lesson for the learner.

For bundle structure, examples, and the detailed quality checklist, read
[Course bundle](references/course-bundle.md) before writing manifests.
