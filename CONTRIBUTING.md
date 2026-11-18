# Engineering Rules

Every contributor (human or agent) follows these rules. The project manager rejects PRs
that break them.

## Workflow
1. Branch from `main`: `feat/<workstream>-<topic>` or `fix/<topic>`.
2. **Tests first.** Write the failing test, commit it (`test: ...`), then write the code
   that makes it pass. The commit history of each PR must show the tests landing first.
3. Keep PRs scoped to the files your workstream owns (see `docs/WORKFLOW.html`).
4. Open a PR against `main` with: summary, how to run, test output, and screenshots for
   any UI change. Then write a short report in `docs/reports/<workstream>.md`.
5. Only the project manager merges.

## Code quality
- Comments in English, no emojis anywhere in code or comments.
- Public functions, classes, and modules carry doc comments (Doxygen `///` in C++,
  TSDoc `/** */` in TypeScript) that explain *why*, not only *what*.
- No heap allocation inside the per-tick simulation loop. Use flat 1D buffers and
  pre-allocated pools sized at construction.
- TypeScript runs in `strict` mode. No `any` unless justified in a comment.
- C++17, compiles warning-free with `-Wall -Wextra -Wpedantic`.

## Logging
- Server: `pino` structured JSON logs (request id, route, status, latency). Log level via
  `LOG_LEVEL`. Never log full request bodies containing grids; log sizes instead.
- Web: a tiny `logger.ts` wrapper (`debug`/`info`/`warn`/`error`) with a level switch;
  log engine selection, Wasm load failures, replans above 5 ms, and API failures.
- C++: no logging inside hot loops. Errors surface through return values.

## Definition of done
- All tests green locally and in CI.
- Lint/typecheck clean.
- Docs updated (doc comments, report file).
- UI changes verified visually (screenshot attached to the PR).
