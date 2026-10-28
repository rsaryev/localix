# Learning Studio

Learning Studio turns Localix into a file-authored course builder and a focused study workspace.

Courses belong to chat sessions. One session may contain several courses and open several course
tabs, but its library, progress, resources, and files are never visible from another session.

The agent authors a normal hierarchy with ordinary file tools:

```text
course.json
modules/<module>/module.json
modules/<module>/lessons/<lesson>/lesson.json
modules/<module>/lessons/<lesson>/steps/<step>/step.json
modules/<module>/lessons/<lesson>/steps/<step>/content.md
```

Drafts live under the workspace `.localix/learning-drafts`. The final `learning_course` activation
validates every manifest, relative reference, id, Markdown file, and theory → testing → practice
sequence. Only a valid bundle is atomically imported into the host-owned session data directory; the
tool returns its canonical manifest path.

This means a malformed lesson never forces the agent to resend a giant JSON payload: it reads the
reported file, repairs it with `Edit`, and activates the same root manifest again. Stable ids
preserve compatible learner progress when a course is adapted.

Ready lessons use a learner-paced sequence shown across the top of the reader. Only the current step
is visible, and future steps and lessons remain locked until their predecessors are complete. Quiz
questions are separate steps: the authoring guide recommends 3–7, and validation caps quiz questions
at 10 per lesson. Wrong answers keep the correct option hidden and expose an explicit retry action.
Options have a stable shuffled display order. Quiz correctness is checked by the backend, and lesson
scores preserve first-attempt results across retries and reloads. Practice solutions are saved
before the host wakes the tutor in the owning chat. The tutor records criterion-based Markdown
feedback; a passing review unlocks continuation.

Courses always prepare complete modules. The first module is ready at activation; later modules
remain outlined. Halfway through a module, or when its last lesson opens, the next module begins
preparing automatically through the same host wake port. A durable claim prevents duplicate
requests; failures retry with a bounded backoff. An open pending lesson refreshes when ready. The
open course and the library hear each change the agent makes through `learning_course` — a review, a
move, an activation — as a pushed mini app command (`shared/course-changes.ts`), and re-read that
chat's courses. A live store feed also invalidates courses after host-side writes. A visible view
uses a one-minute fallback poll only when that feed is unavailable.

The course library can export a validated bundle as one `.localix-course` file and import it into a
different chat session. The portable file contains only manifest-reachable course material—never
session progress, comments, or unrelated files copied into the course directory.

The complete hierarchy is available through `localix://resource/learning/<course-id>/...` resources
inside the owning session. Selecting prose creates anchored comments that can be staged into the
owning chat composer with the exact course step as context. All prose uses the host's
`@localixai/kit/markdown` renderer, including syntax-highlighted code fences.

## Try it

```text
/learning:create system design for a backend engineer
```

For a targeted lesson repair or explicit regeneration:

```text
/learning:lesson lesson-id
```

Use `/learning:adapt` to patch only the affected lesson files and re-activate the course.

## Related guides

- [Memory and Learning Studio](../../docs/features/learning-loop.md)

## Source of truth

- [Mini app manifest](mini-app.json) and [agent guide](guide.md)
- [Course activation and step validation](backend/course-bundle.ts)
- [Progress and answer handling](backend/service.ts)
- [Module generation claims and retries](backend/module-generation.ts)
- [Portable import and export](backend/course-portable.ts)
- [Course invalidation and fallback polling](ui/model/courseChanges.ts)
- [Course authoring contract](guide/course-bundle.md)
