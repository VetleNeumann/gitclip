// Parallel Planner with Review — four-phase orchestration loop
//
// Phase 1 (Plan):             A codex agent reads open issues, builds a
//                             dependency graph, and outputs a <plan> JSON
//                             listing unblocked issues with branch names.
// Phase 2 (Execute + Review): Per issue, a sandbox is created via
//                             createSandbox(). Implementer runs first
//                             (100 iterations). If it produces commits, a
//                             reviewer runs in the same sandbox on the same
//                             branch (5 iterations). All issue pipelines
//                             run concurrently via Promise.allSettled().
// Phase 3 (Merge):            One agent merges all completed branches into
//                             the current branch.
//
// The outer loop repeats up to MAX_ITERATIONS times so newly unblocked
// issues are picked up after each round of merges.
//
// Usage:
//   npx tsx .sandcastle/main.mts
// Or via package.json:
//   "scripts": { "sandcastle": "npx tsx .sandcastle/main.mts" }

import * as sandcastle from "@ai-hero/sandcastle";
import { podman } from "@ai-hero/sandcastle/sandboxes/podman";
import { execFileSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// All four phases run on OpenAI's gpt-5.3-codex via the codex CLI inside the
// sandbox. Auth: OPENAI_API_KEY is read from the host process env and passed
// into the container by the agent provider's env merge.
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  throw new Error(
    "OPENAI_API_KEY is not set on the host. Export it before running sandcastle.",
  );
}

const GH_TOKEN = process.env.GH_TOKEN;
if (!GH_TOKEN) {
  throw new Error(
    "GH_TOKEN is not set on the host. The agent needs it for `gh` calls.",
  );
}

const codexAgent = () =>
  sandcastle.codex("gpt-5.3-codex", {
    effort: "high",
    env: { OPENAI_API_KEY, GH_TOKEN },
  });

// Maximum number of plan→execute→merge cycles before stopping.
const MAX_ITERATIONS = 10;

const hostRepoDir = process.cwd();

// Hooks run inside the sandbox before the agent starts each iteration.
// - npm install: hydrates root + workspaces (web, mcp, netlify/functions)
//   so vitest / tsc / vite are available on first iteration without paying
//   the install cost mid-task.
// - codex login --with-api-key: hands the host's OPENAI_API_KEY to the
//   codex CLI inside the container.
// - gh auth login + setup-git: wires GH_TOKEN into both `gh` (for API
//   calls) and git's credential helper (for `git fetch`/`push` over
//   HTTPS). Without this, every fetch/push hit "missing GitHub
//   credentials" and the agents fell back to stale local refs.
// - force HTTPS origin: bind-mounted worktrees inherit the host's remote
//   URL, which may be SSH (`git@github.com:…`). The sandbox has no SSH
//   key + no known_hosts, so SSH push fails with "Host key verification
//   failed". Rewriting to HTTPS routes the push through the credential
//   helper above.
const hooks = {
  sandbox: {
    onSandboxReady: [
      { command: "npm install" },
      { command: "printenv OPENAI_API_KEY | codex login --with-api-key" },
      {
        command:
          'sh -c \'T="$GH_TOKEN"; unset GH_TOKEN; printf %s "$T" | gh auth login --with-token\'',
      },
      { command: "gh auth setup-git" },
      {
        command:
          "git remote get-url origin | grep -q '^git@' && " +
          'git remote set-url origin "$(gh repo view --json url --jq .url).git" || true',
      },
    ],
  },
};

const worktreeSandbox = podman({
  env: {
    OPENAI_API_KEY,
    GH_TOKEN,
  },
});

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
  console.log(`\n=== Iteration ${iteration}/${MAX_ITERATIONS} ===\n`);

  // -------------------------------------------------------------------------
  // Phase 1: Plan
  //
  // Planner reads the open issue list, builds a dependency graph, and selects
  // issues that can be worked in parallel right now (no blocking deps on
  // other open issues). Outputs a <plan> JSON block — parsed below.
  // -------------------------------------------------------------------------
  const plan = await sandcastle.run({
    hooks,
    sandbox: podman(),
    name: "planner",
    maxIterations: 1,
    agent: codexAgent(),
    promptFile: "./.sandcastle/plan-prompt.md",
  });

  const planMatch = plan.stdout.match(/<plan>([\s\S]*?)<\/plan>/);
  if (!planMatch) {
    throw new Error(
      "Planning agent did not produce a <plan> tag.\n\n" + plan.stdout,
    );
  }

  const { issues } = JSON.parse(planMatch[1]!) as {
    issues: { id: string; title: string; branch: string }[];
  };

  if (issues.length === 0) {
    console.log("No unblocked issues to work on. Exiting.");
    break;
  }

  console.log(
    `Planning complete. ${issues.length} issue(s) to work in parallel:`,
  );
  for (const issue of issues) {
    console.log(`  ${issue.id}: ${issue.title} → ${issue.branch}`);
  }

  // -------------------------------------------------------------------------
  // Phase 2: Execute + Review
  //
  // Per issue, createSandbox() so implementer + reviewer share the same
  // sandbox per branch. Implementer runs first; if it produces commits the
  // reviewer runs in the same sandbox.
  //
  // Promise.allSettled means one failing pipeline doesn't cancel the others.
  // -------------------------------------------------------------------------
  const settled = await Promise.allSettled(
    issues.map(async (issue) => {
      const sandbox = await sandcastle.createSandbox({
        branch: issue.branch,
        sandbox: worktreeSandbox,
        hooks,
      });

      try {
        const implement = await sandbox.run({
          name: "implementer",
          maxIterations: 100,
          agent: codexAgent(),
          promptFile: "./.sandcastle/implement-prompt.md",
          promptArgs: {
            TASK_ID: issue.id,
            ISSUE_TITLE: issue.title,
            BRANCH: issue.branch,
          },
        });

        if (implement.commits.length > 0) {
          const review = await sandbox.run({
            name: "reviewer",
            // 5 iterations: enough room for the reviewer's narrow job
            // (read diff, maybe one fast verification, one commit) without
            // enabling deep rabbit-holes — the prompt pins scope.
            maxIterations: 5,
            agent: codexAgent(),
            promptFile: "./.sandcastle/review-prompt.md",
            promptArgs: {
              BRANCH: issue.branch,
            },
          });

          // Merge commits from both runs so the merge phase sees all of them.
          return {
            ...review,
            commits: [...implement.commits, ...review.commits],
          };
        }

        return implement;
      } finally {
        await sandbox.close();
      }
    }),
  );

  for (const [i, outcome] of settled.entries()) {
    if (outcome.status === "rejected") {
      console.error(
        `  ✗ ${issues[i]!.id} (${issues[i]!.branch}) failed: ${outcome.reason}`,
      );
    }
  }

  // Pass branches to the merge phase if either:
  //   (a) this iteration produced commits, OR
  //   (b) the branch has commits ahead of origin/main from a prior iteration
  //       whose merger crashed before integrating them. Without (b) such
  //       branches loop forever: the implementer correctly fast-bails
  //       ("already done"), commits.length === 0, the merger never sees the
  //       branch, the issue stays open, and the next plan re-dispatches it.
  try {
    execFileSync("git", ["fetch", "origin", "--quiet"], {
      cwd: hostRepoDir,
      stdio: "inherit",
    });
  } catch (error) {
    console.warn(
      `git fetch origin failed before unmerged-branch sweep: ${error}. ` +
        "Falling back to current-iteration commits only.",
    );
  }

  const branchHasUnmergedCommits = (branch: string): boolean => {
    try {
      const out = execFileSync(
        "git",
        ["rev-list", "--count", `origin/main..${branch}`],
        { cwd: hostRepoDir, stdio: ["ignore", "pipe", "pipe"] },
      )
        .toString()
        .trim();
      return Number(out) > 0;
    } catch {
      return false;
    }
  };

  const completedIssues = settled
    .map((outcome, i) => ({ outcome, issue: issues[i]! }))
    .filter(
      (entry) =>
        entry.outcome.status === "fulfilled" &&
        (entry.outcome.value.commits.length > 0 ||
          branchHasUnmergedCommits(entry.issue.branch)),
    )
    .map((entry) => entry.issue);

  const completedBranches = completedIssues.map((i) => i.branch);

  console.log(
    `\nExecution complete. ${completedBranches.length} branch(es) with commits:`,
  );
  for (const branch of completedBranches) {
    console.log(`  ${branch}`);
  }

  if (completedBranches.length === 0) {
    console.log("No commits produced. Nothing to merge.");
    continue;
  }

  // -------------------------------------------------------------------------
  // Phase 3: Merge
  //
  // One agent merges all completed branches into the current branch,
  // resolving any conflicts and running tests to confirm everything works.
  // -------------------------------------------------------------------------
  await sandcastle.run({
    hooks,
    sandbox: podman(),
    name: "merger",
    maxIterations: 1,
    agent: codexAgent(),
    promptFile: "./.sandcastle/merge-prompt.md",
    promptArgs: {
      BRANCHES: completedBranches.map((b) => `- ${b}`).join("\n"),
      ISSUES: completedIssues
        .map((i) => `- ${i.id}: ${i.title}`)
        .join("\n"),
    },
  });

  console.log("\nBranches merged.");
}

console.log("\nAll done.");
