You are running an unattended execution session

Objective:
- Complete all pending tasks in tasks/TODO.md.
- Use tasks/TASK_STATE.md as the source of truth for progress and resumability.
- Ensure delivery coverage includes all currently defined scope phases and `docs/spec/gaps.md` gap items.

Execution loop (repeat until done):
1. Read tasks/TODO.md and tasks/TASK_STATE.md.
2. Validate TODO coverage maps still include all active phases and gap IDs in `docs/spec/gaps.md`; update TODO/TASK_STATE first if scope changed.
3. Select the next task with status `pending` whose dependencies are `done`.
4. Update tasks/TASK_STATE.md:
   - set `current_task_id`
   - set task status to `in_progress`
   - set `Started UTC`
   - update `last_updated_utc`
5. Implement the task with minimal, clean code (KISS/YAGNI, no over-engineering).
6. Add/update unit tests and e2e tests for behavior changes.
7. Run tests (targeted first, then broader/full suites when appropriate).
8. Update docs in the same task when relevant:
   - docs/index.md
   - docs/product/*
   - docs/spec/*
   - README.md
   - site.env (if/when it exists)
9. Mark the task complete in both files:
   - check it in tasks/TODO.md
   - set status `done` in tasks/TASK_STATE.md with `Finished UTC`, commit hash, and notes
   - update counters (`completed_tasks`, `blocked_tasks`, `next_task_id`, `last_updated_utc`)
10. If the task closes one or more gap IDs, note the closed gap IDs in TASK_STATE notes and keep TODO/Gap Coverage map accurate.
11. Commit with: feat(<task-id>): <short description>
12. Continue immediately to the next task without waiting for confirmation.
13. If there are user actions needed (credentials, infra, account setup, policy decisions), record exact requirements in kora-bot/tasks/USER_ACTIONS_CHECKLIST.md.
    - Record every user-owned blocker for any feature path: missing inputs/secrets/IDs and required user setup actions (infra/account/config cutover) that the agent cannot perform.
    - Write entries as concrete requirements with a one-line blocker reason tied to the feature/runtime path.
    - Include setup/provision/enable actions only when they are required for feature correctness.
    - Do NOT add routine verification/check steps, ownership assignments, or optional tasks.
    - Organize entries by feature area (core runtime, conditional features, updater features, deploy/infra features).

Blocker policy:
- If blocked by missing credentials, external account setup, or user-only decisions:
  - mark task status `blocked` in tasks/TASK_STATE.md with exact blocker text and required input
  - leave task unchecked in tasks/TODO.md
  - append blocker entry to Run Log
  - add/update the exact missing input or required user setup action in `tasks/USER_ACTIONS_CHECKLIST.md` under the relevant feature area
  - continue with the next unblocked pending task
- Stop only when every task is `done` or `blocked`.

Autonomy policy:
- Do not ask for normal confirmations between tasks.
- If a task is too large, split it into practical child tasks in tasks/TODO.md and tasks/TASK_STATE.md, then continue.

Quality and safety guardrails:
- Follow AGENTS.md (root + local project instructions).
- Keep comments accurate; do not remove IMPORTANT/all-caps/marked comments.
- Maintain API/type integrity.
- Keep approval-gated actions protected by policy.
- Keep execution-plane boundaries intact:
  - Lambda is control plane.
  - Long-running code-change tasks run in execution plane worker.
- Keep Discord dual-server policy intact:
  - Kora Labs server is default approval/ops control plane
  - Handles server is community/ticket plane with limited moderator approval scope
- Ignore `docs/human_notes/notes.md` as implementation source of truth.
