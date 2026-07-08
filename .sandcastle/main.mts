// Parallel Planner — three-phase orchestration loop
//
// Phase 1 (Plan):             A codex agent reads open issues, builds a
//                             dependency graph, and outputs a <plan> JSON
//                             listing unblocked issues with branch names.
// Phase 2 (Execute):          Per issue, a sandbox is created via
//                             createSandbox(). Implementer runs
//                             (100 iterations). All issue pipelines
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

// SANDCASTLE_AGENT={codex,claude} selects provider per invocation. Codex
// path uses gpt-5.3-codex high effort across all phases. Claude path uses
// Opus 4.7 max effort for the planner and Sonnet 4.6 high effort for the
// volume phases (implementer/merger).
const SANDCASTLE_AGENT =
  (process.env.SANDCASTLE_AGENT as "codex" | "claude" | undefined) ?? "codex";
if (SANDCASTLE_AGENT !== "codex" && SANDCASTLE_AGENT !== "claude") {
  throw new Error(
    `SANDCASTLE_AGENT must be "codex" or "claude" (got ${SANDCASTLE_AGENT!}).`,
  );
}

const GH_TOKEN = process.env.GH_TOKEN;
if (!GH_TOKEN) {
  throw new Error(
    "GH_TOKEN is not set on the host. The agent needs it for `gh` calls.",
  );
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (SANDCASTLE_AGENT === "codex" && !OPENAI_API_KEY) {
  throw new Error(
    "OPENAI_API_KEY is not set on the host. Export it before running sandcastle with SANDCASTLE_AGENT=codex.",
  );
}

const planAgent = () =>
  SANDCASTLE_AGENT === "claude"
    ? sandcastle.claudeCode("claude-opus-4-7", { effort: "max" })
    : sandcastle.codex("gpt-5.3-codex", { effort: "high" });

const workAgent = () =>
  SANDCASTLE_AGENT === "claude"
    ? sandcastle.claudeCode("claude-sonnet-4-6", { effort: "high" })
    : sandcastle.codex("gpt-5.3-codex", { effort: "high" });

// Maximum number of plan→execute→merge cycles before stopping.
const MAX_ITERATIONS = 10;

const hostRepoDir = process.cwd();

// Hooks run inside the sandbox before the agent starts each iteration.
// SANDCASTLE_AGENT is injected into the sandbox env below so in-container
// `sh -c` can branch on it.
// - npm install: hydrates root + workspaces (web, mcp, netlify/functions).
// - codex login: feeds OPENAI_API_KEY to codex CLI; skipped on claude.
// - claude auth: confirms ~/.claude/.credentials.json bind-mounted in.
// - gh auth + force HTTPS origin: both providers need gh credentials and
//   HTTPS push routing through the credential helper.
const hooks = {
  sandbox: {
    onSandboxReady: [
      { command: "npm install" },
      {
        command:
          'sh -c \'[ "$SANDCASTLE_AGENT" = "claude" ] || printenv OPENAI_API_KEY | codex login --with-api-key\'',
      },
      {
        command:
          'sh -c \'[ "$SANDCASTLE_AGENT" = "codex" ] || test -f "$HOME/.claude/.credentials.json" || { echo "claude: ~/.claude/.credentials.json missing inside sandbox; check ro mount" >&2; exit 1; }\'',
      },
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

// Mount the host's OAuth credentials file (only) into the sandbox when the
// claude provider is active. Whole-dir ro mount blocks claude from writing
// session JSONL under ~/.claude/projects/ and trips session-capture.
const claudeMount =
  SANDCASTLE_AGENT === "claude"
    ? [
        {
          hostPath: "~/.claude/.credentials.json",
          sandboxPath: "~/.claude/.credentials.json",
          readonly: true,
        },
      ]
    : [];

const sandboxEnv: Record<string, string> = {
  SANDCASTLE_AGENT,
  GH_TOKEN,
};
if (SANDCASTLE_AGENT === "codex") {
  sandboxEnv.OPENAI_API_KEY = OPENAI_API_KEY!;
}

const worktreeSandbox = podman({
  mounts: claudeMount,
  env: sandboxEnv,
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
    sandbox: podman({ mounts: claudeMount, env: sandboxEnv }),
    name: "planner",
    maxIterations: 1,
    agent: planAgent(),
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
  // Phase 2: Execute
  //
  // Per issue, createSandbox() so the implementer gets its own sandbox per
  // branch. Implementer runs and produces commits.
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
          agent: workAgent(),
          promptFile: "./.sandcastle/implement-prompt.md",
          promptArgs: {
            TASK_ID: issue.id,
            ISSUE_TITLE: issue.title,
            BRANCH: issue.branch,
          },
        });

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
    sandbox: podman({ mounts: claudeMount, env: sandboxEnv }),
    name: "merger",
    maxIterations: 1,
    agent: workAgent(),
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
