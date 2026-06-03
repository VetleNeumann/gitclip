# TASK

Merge the following branches into `main` (the current branch), then push,
close issues, and clean up. Operate **autonomously** — do not ask the user
for confirmation. This is a CI-style run; nobody is at the keyboard.

Branches to merge (in order):

{{BRANCHES}}

# WORKING-TREE PRECONDITION

If `git status` shows uncommitted changes you didn't make:

1. **Pre-empt untracked/merge collisions.** Any **untracked** local file
   whose path is tracked on a branch in the merge list will collide
   when the merge brings that path in, and `git stash pop` later will
   refuse to restore an untracked entry over the now-tracked file.
   Rename each colliding path to `<path>.local` first so the local
   copy survives as an untracked sibling:

   ```
   # Substitute the branches from the list above (one per `for` arg).
   merge_paths=$(for b in <branch-1> <branch-2> ...; do
     git ls-tree -r --name-only "$b"
   done | sort -u)
   for f in $(git ls-files --others --exclude-standard); do
     if printf '%s\n' "$merge_paths" | grep -qFx "$f"; then
       mv "$f" "$f.local"
     fi
   done
   ```

2. **Then stash everything else:**

   ```
   git stash push -u -m sandcastle-merger-pre-merge
   ```

3. Finish merge / push / cleanup, then `git stash pop` at the very end.

Do **not** ask the user — stashing is the standing instruction. Report
any `<path>.local` files in the final summary so the user knows where
their work was parked.

# REMOTE SYNC PRECONDITION — REQUIRED

Before any merges, sync local `main` with remote so the eventual `git push`
is fast-forward:

```
git fetch origin
git rebase origin/main   # or `git merge --ff-only origin/main` if rebase
                         # would rewrite local-only commits
```

If `origin/main` is ahead of local `main`, the rebase brings local up to
date. Skipping this caused multiple past runs to merge a full train, pass
tests, then have `git push origin main` rejected as non-fast-forward —
which left issues open and triggered the next iteration to re-dispatch the
same work.

# MERGE LOOP

For each branch above, in order:

1. `git merge <branch> --no-edit`
2. If conflicts:
   - **Safe to auto-resolve**: additive edits in test files, separate
     functions, non-overlapping config blocks. Read both sides, combine,
     `git add`, `git commit --no-edit`.
   - **Stop and report**: conflicts that change a function signature,
     touch the same logical block in `web/src/` or `mcp/src/`, or span
     multiple files where a wrong pick desyncs callers (e.g.
     `web/src/lib/scriptGen.ts` + a caller). Abort the merge with
     `git merge --abort`, output a short report naming the branches and
     files, and skip this branch. Continue with the rest of the list.
   - When auto-resolving, prefer the change that preserves the branch's
     intent over `main`'s prior state when both make sense.
3. After the merge commit lands, run **`npm test`** to verify the
   test suite stays green. If `web/` or `mcp/` source changed, also run
   the relevant **`npm --workspace <web|mcp> run build`** so a TypeScript
   regression can't slip through (vitest doesn't type-check).
4. If tests or builds fail: investigate, fix forward on `main` with a
   small follow-up commit (Conventional Commits format), and re-run.
   Do not abort the merge sequence; keep going through the list.

# FIX-FORWARD POLICY — REQUIRED

You may fix forward on `main` only when the failure is caused by the
merged code itself or by something this run is responsible for:

- test failures caused by the merge
- malformed workflow YAML (see WORKFLOW PREFLIGHT)
- conflict resolutions you chose

You may **not** fix forward to paper over **environment** failures:

- missing host tooling (`podman: command not found`, no `docker`,
  no `just`, no language toolchain, etc.)
- absent or invalid secrets / credentials
- network unreachable
- broken sandbox / container setup

These are infra problems, not regressions of `main`. Editing
`test`/`smoke`/`Makefile` targets to skip steps "when the tool is
missing" is a real product change with real review cost; do **not**
commit such shims silently from the merger. Instead: stop, leave
`main` untouched by a shim commit, skip the push for this train, and
report the environment failure plainly.

# WORKFLOW PREFLIGHT — REQUIRED

Before pushing, validate every GitHub Actions workflow file (skip if
`.github/workflows/` is empty or absent). A malformed workflow YAML is
silent on local `npm test` but tanks every push to `main` after it
(run created, 0 jobs, no logs). Catch it here.

```
if compgen -G ".github/workflows/*.yml" > /dev/null; then
  actionlint .github/workflows/*.yml
fi
```

`actionlint` is preinstalled in the sandcastle container. It catches:
YAML parse errors (e.g. unquoted `step name: with: colons`), unknown
keys, expression syntax, action `uses:` typos.

If `actionlint` reports an error:

1. Fix the workflow file on `main` with a small follow-up commit
   (Conventional Commits, e.g. `ci: quote step names with colons`).
2. Re-run `actionlint` until clean.
3. Then proceed to PUSH.

Do **not** push with a red `actionlint`. Do not skip this step.

# PUSH

After every branch in the list has been merged and tests pass, push:

```
git push origin main
```

This is **mandatory**. Do not output `<promise>COMPLETE</promise>` until
the push has succeeded. Never use `--force` / `--force-with-lease`.

If the push is rejected as non-fast-forward, the remote moved during the
merge train. Recover **once**:

```
git fetch origin
git rebase origin/main
npm test
git push origin main
```

If the push fails for auth (`Host key verification failed`, missing
credentials, SSH refusal), recover **once**:

```
gh auth setup-git
git remote set-url origin "$(gh repo view --json url --jq .url).git"
git push origin main
```

This forces HTTPS + a fresh `gh`-managed credential helper. If the
second push still fails, report plainly and stop — leave any stash in
place. Closing issues + cleanup require a successful push.

# CLOSE ISSUES

For each branch that was successfully merged into pushed `main`, close
its issue:

```
gh issue close <ID> --comment "Completed by Sandcastle"
```

Note: implementer commits already carry a `Closes #<ID>` trailer, so
GitHub may auto-close once the push lands. Run the explicit
`gh issue close` anyway — idempotent, ensures the comment is added.

Issues:

{{ISSUES}}

# CLEAN UP

Once push + issue close succeed, delete each merged branch locally and
on origin:

- Local: `git branch -d <branch>`
- Remote: `git push origin --delete <branch>`

Only delete a branch whose merge commit is in `origin/main`. Do **not**
use `-D` (force delete). If `-d` refuses, leave the branch and report it.

# RESTORE STASH

If you stashed pre-merge changes at the top, finish with:

```
git stash pop
```

If the pop conflicts, leave the stash in place and report. (The
WORKING-TREE PRECONDITION step above pre-empts the common
untracked-vs-now-tracked case; any conflict that still gets here is a
genuine overlap and needs the user.)

# DONE

Output `<promise>COMPLETE</promise>` only after push + close + cleanup +
stash-pop have all succeeded (or been explicitly skipped per the rules
above).
