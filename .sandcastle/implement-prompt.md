# TASK

Fix issue {{TASK_ID}}: {{ISSUE_TITLE}}

Pull in the issue using `gh issue view {{TASK_ID}}`. If it has a parent PRD, pull that in too.

Only work on the issue specified.

# BRANCH — STRICT

You are already checked out on branch `{{BRANCH}}`. Use **this exact branch
name verbatim** for every git operation (commits, pushes, anywhere a branch
name appears). Do **not** create or rename to a different branch, even if
you think a clearer slug exists. The planner picked this name and the
merger expects it.

Verify before your first commit:

```
git rev-parse --abbrev-ref HEAD   # must print: {{BRANCH}}
```

If it doesn't match, stop and report — do not silently rename.

# FAST BAIL-OUT — CHECK FIRST

Before exploring the repo or running any tests, check whether issue
`#{{TASK_ID}}` was already fixed and merged on a previous run:

```
git fetch origin --quiet
git log origin/main --grep "Closes #{{TASK_ID}}" --oneline
```

If that prints any commit, the work is already merged on `origin/main` but
the issue stayed open (likely because a prior merger run failed to push or
close). Do not re-implement, do not run tests, do not re-explore. Output:

```
<promise>COMPLETE</promise>
```

…and stop. The merger / a maintainer will close the issue out-of-band. A
~10-minute redundant sandbox run on already-shipped code is the
anti-pattern this guard exists for.

Only continue past this section if no `Closes #{{TASK_ID}}` commit is on
`origin/main`.

# REBASE BEFORE WORKING — STRICT

If `{{BRANCH}}` already exists with commits ahead of `origin/main`, rebase
it onto current `origin/main` **before** writing any new code:

```
git fetch origin --quiet
git rebase origin/main
```

If the rebase produces conflicts, resolve them in-place (the existing
branch commits are yours to amend), `git add` the resolved files, and run
`git rebase --continue` until the rebase finishes. Do not abort and
re-create — the merger expects this branch name with a fast-forwardable
history.

After a successful rebase the eventual push will need `--force-with-lease`
because the branch was rewritten. Use `--force-with-lease` (never plain
`--force`) so a concurrent push from another agent is not silently
overwritten.

Skip this section only if the branch is empty (no commits ahead of
`origin/main`) — the first commit you make will land directly on top of
current `origin/main`.

Rationale: the merger refuses to auto-resolve conflicts in `web/src/`
(and similar surfaces). If the branch is stale, merging will abort
forever and the planner will re-pick this issue every cycle. Rebase
moves the conflicts here, where you have the context to resolve them.

## Auth-failure fallback

If `git fetch origin` fails (missing GitHub credentials, SSH host-key,
network), retry **once** after `gh auth setup-git`. If it still fails:

1. Skip the shipped-issue check and proceed against local `origin/main`
   refs (which may be stale).
2. Add a single line to your final commit message body:
   `Note: remote refs unavailable in sandbox; verify origin/main after push.`
3. Do **not** burn additional bash calls retrying. Auth is sandbox-level
   config; the merger will surface the real state.

# CONTEXT

Here are the last 10 commits:

<recent-commits>

!`git log -n 10 --format="%H%n%ad%n%B---" --date=short`

</recent-commits>

# EXPLORATION

Explore the repo and fill your context window with relevant information that will allow you to complete the task.

Pay extra attention to test files that touch the relevant parts of the code.

# EXECUTION

If applicable, use TDD red-green-refactor:

1. RED: write one failing test
2. GREEN: write the minimum implementation to pass that test
3. REPEAT until done
4. REFACTOR

# FEEDBACK LOOPS

This is a Node + TypeScript monorepo (npm workspaces: `web`, `mcp`,
`netlify/functions`).

- Run the suite with **`npm test`** (delegates to `vitest --run` in the
  `web` workspace). Use **`npm --workspace web run test -- --run <path>`**
  to target a single test file for fast iteration.
- Type-check / build with **`npm --workspace web run build`** (runs
  `tsc -b && vite build`) when touching `web/`, or
  **`npm --workspace mcp run build`** when touching `mcp/`.
- Do **not** introduce `pytest`, `uv`, `mypy`, `ruff`, or any Python
  tooling — this repo is JS/TS only.

# COMMIT

Make one or more git commits on `{{BRANCH}}`. Each commit message **must**
follow Conventional Commits:

```
<type>(<scope>): <short subject under 72 chars>

<optional body explaining why, not what>

Closes #{{TASK_ID}}
```

Allowed types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `perf`,
`build`, `ci`, `style`. Pick the one that matches the change.

The trailing `Closes #{{TASK_ID}}` line is mandatory on at least one commit
in the branch — GitHub will close the issue when the branch reaches main.

Do **not** prefix with `RALPH:` or any agent identifier. The commit log is
read by humans; keep it clean.

# THE ISSUE

If the task is not complete, leave a comment on the issue with what was
done and what remains.

Do not close the issue yourself — the merger does it after merging.

Once complete, output `<promise>COMPLETE</promise>`.

# FINAL RULES

ONLY WORK ON A SINGLE TASK. Do not touch unrelated code.
