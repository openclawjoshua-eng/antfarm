# AmakaFlow Codebase — Developer Learnings

Read this BEFORE starting any develop step. Updated nightly by morning-status cron.

## Repositories

- Android app: `supergeri/amakaflow-android-app` (Kotlin/Compose/Gradle)
- Backend API: FastAPI (Python), Postgres, Redis
- Mobile: React Native / Expo

## Branch Naming

`ama-<ticket-number>-<short-description>` — e.g. `ama-737-add-conflict-marker-ci`

Always use `git checkout -B <branch>` (not `-b`) to avoid branch-already-exists errors on retry.

## Work Directory

Clean before cloning: `rm -rf /tmp/{{ticket_id}}-work`

## Common Gotchas

- Android projects: no local JDK — skip local tests, CI handles `./gradlew testDebugUnitTest`
- Always check for existing PRs before opening a new one: `gh pr list --repo <repo> --head <branch>`
- Test command must be added to Linear ticket description under `## Test command:`

## Codebase Patterns

- Follow existing file structure — don't create new directories without reason
- Prefer editing existing files over creating new ones
- Keep changes minimal and focused on the ticket requirements

===OUTPUT FORMAT===
When you complete the develop step, output EXACTLY this (filled in):

STATUS: done
BRANCH: ama-XXX-your-branch-name
PR_URL: https://github.com/supergeri/amakaflow-android-app/pull/99
CHANGES: One-line summary of what was implemented

If failed:

STATUS: fail
REASON: Brief description of what went wrong
===END OUTPUT FORMAT===
