# AmakaFlow Codebase — Developer Learnings

Read this BEFORE starting any develop step. Updated nightly by morning-status cron.

## Repositories (Amakaflow org)

- Backend API: `Amakaflow/amakaflow-backend` — FastAPI (Python), Postgres, Redis — **default branch: `develop`**
- Frontend: `Amakaflow/amakaflow-ui` — TypeScript/React — default branch: `main`
- iOS app: `Amakaflow/amakaflow-ios-app` — Swift/Xcode — default branch: `main`
- Android app: `Amakaflow/amakaflow-android-app` — Kotlin/Compose/Gradle — default branch: `main`
- E2E tests: `Amakaflow/amakaflow-automation` — Maestro YAML — default branch: `main`

⚠️ amakaflow-backend uses `develop` not `main` — always branch from and PR into `develop`.

## Branch Naming

`feature/<ticket-id>-<short-description>` — e.g. `feature/AMA-737-conflict-marker-ci`

Always use `git checkout -B <branch>` (not `-b`) to avoid branch-already-exists errors on retry.

## Work Directory

Clean before cloning: `rm -rf /tmp/{{ticket_id}}-work`

## Common Gotchas

- Android projects: no local JDK — skip local tests, CI handles `./gradlew testDebugUnitTest`
- iOS projects: no Xcode in agent environment — skip local tests, CI handles `xcodebuild test`
- Always check for existing PRs before opening a new one: `gh pr list --repo <repo> --head <branch>`
- Backend tests: `pytest` from repo root; install deps first: `pip install -e ".[dev]"` or `pip install -r requirements.txt`
- TypeScript tests: `npm test` or `npx vitest run`

## Codebase Patterns

- Follow existing file structure — don't create new directories without reason
- Prefer editing existing files over creating new ones
- Keep changes minimal and focused on the ticket acceptance criteria
- Do NOT commit TASK.md
