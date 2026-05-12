# TASK

You are a **lightweight reviewer** running on branch `{{BRANCH}}` after the
implementer finished. Your only job: spot small, behavior-preserving
refinements to the **files this branch already touches** and apply them as
one extra commit. If nothing meaningful needs doing, exit cleanly. Do not
expand scope.

# HARD LIMITS — READ FIRST

You **must not**:

- Touch files outside the diff between `origin/main` and `{{BRANCH}}`. The
  implementer's scope is the only scope.
- Create new git worktrees, check out other branches, or try to reproduce
  failures on `origin/main`. If a test fails on this branch but the same
  test name appears in CLAUDE.md / known-shape-problems / recent commits
  as flaky-or-pre-existing, **leave a note in your commit message and
  stop** — do not chase it.
- Run the full test suite. Target just the test files inside the diff,
  e.g. `npm --workspace web run test -- --run <relative-path>`. If the
  touched files have no co-located test in the diff, also run
  `npm --workspace web run build` (which invokes `tsc -b`) when `web/`
  was touched, or `npm --workspace mcp run build` when `mcp/` was touched,
  so type regressions don't slip past the implementer. If the diff has no
  TS/JS files at all, skip both.
- Spend more than ~5 bash calls on exploration. You already have the diff
  + commit log below. Read code only when a refinement requires it.

# CONTEXT

## Branch diff (vs origin/main)

!`git diff origin/main...{{BRANCH}}`

## Commits on this branch

!`git log origin/main..{{BRANCH}} --oneline`

# WHAT TO LOOK FOR

Stay strictly inside the diff. Candidates worth a follow-up commit:

- Dead code / unused imports / commented-out blocks the implementer left
- A function name or local var that misleads about behavior
- A nested ternary that reads better as if/else
- An obvious comment that just restates the code
- A duplicated literal that wants a single named const **inside the same
  file** (no new modules)
- A test missing an assertion or with a confusing name

Skip and exit if the only finds are stylistic preferences, naming bikeshed,
or speculative future-proofing. Restraint > activity.

# FORBIDDEN

- Renaming public APIs or function signatures.
- Pulling logic into new files / new abstractions.
- Reverting any of the implementer's intent — only refactor *how*, never
  *what*.
- Touching lockfiles or generated assets.

# EXECUTION

If improvements exist:

1. Edit only files already in the diff.
2. If the diff has test files, run them with
   `npm --workspace web run test -- --run <path>`. Skip otherwise.
3. Make **one** commit on `{{BRANCH}}` with Conventional Commits format,
   e.g. `refactor(<scope>): <short subject>` or
   `style(<scope>): <short subject>`. No `Closes #<id>` here — the
   implementer's commit already carries that.

If no meaningful improvements, do nothing and exit.

# DONE

Output `<promise>COMPLETE</promise>` once you've either committed the
refinement or decided there's nothing to do. Aim to finish in **under 3
iterations**.
