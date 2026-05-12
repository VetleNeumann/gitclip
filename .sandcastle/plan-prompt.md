# ISSUES

Here are the open issues in the repo:

<issues-json>

!`gh issue list --state open --search 'label:ready-for-agent -label:"ready-for-human"' --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`

</issues-json>

# TASK

**Step 0 — drop already-shipped issues.** Before dependency analysis, run

```
git fetch origin --quiet
```

then for each candidate issue `N`, check `git log origin/main --grep "Closes #N" --oneline`. If a commit on `origin/main` already closes the issue, **omit it from the plan** — the work merged but the issue stayed open (auto-close didn't fire, e.g. the merge commit message lacked the trailer). Re-dispatching it just burns a sandbox running the same diagnostic dance to no effect. A maintainer will close it out-of-band.

If `git fetch origin` fails (auth/network), retry once after `gh auth setup-git`. If still failing, run the shipped-issue check against the (possibly stale) local `origin/main` and add `"warning": "remote refs unavailable; plan based on local origin/main"` to the JSON output so downstream consumers know the plan may include already-shipped work.

Then analyze the remaining open issues and build a dependency graph. For each issue, determine whether it **blocks** or **is blocked by** any other open issue.

An issue B is **blocked by** issue A if:

- B requires code or infrastructure that A introduces
- B and A modify overlapping files or modules, making concurrent work likely to produce merge conflicts
- B's requirements depend on a decision or API shape that A will establish

An issue is **unblocked** if it has zero blocking dependencies on other open issues.

For each unblocked issue, assign a branch name using the format `sandcastle/issue-{id}-{slug}`.

**Step 2 — priority filter.** If any unblocked issue carries the `priority` label, keep only the priority-labeled issues in the output. Non-priority unblocked issues are deferred to the next round (they re-surface once the priority queue drains). Apply the same dependency rules within the priority subset: a blocked priority issue is still excluded.

# OUTPUT

Output your plan as a JSON object wrapped in `<plan>` tags:

<plan>
{"issues": [{"id": "42", "title": "Fix auth bug", "branch": "sandcastle/issue-42-fix-auth-bug"}]}
</plan>

Include only unblocked issues, narrowed by the priority filter when it applies. If every issue is blocked, include the single highest-priority candidate (the one with the fewest or weakest dependencies).
