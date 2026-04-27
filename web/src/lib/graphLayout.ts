export interface CommitLike {
  sha: string;
  parents: string[];
}

export interface GraphNode {
  sha: string;
  parents: string[];
  /** The lane this commit's dot is rendered on. */
  laneIdx: number;
  /**
   * Active lanes flowing INTO this row from the row above.
   * Index = lane index, value = sha that lane is "expecting" or null if unused.
   */
  inLanes: (string | null)[];
  /**
   * Active lanes flowing OUT of this row to the row below.
   * Same shape as inLanes.
   */
  outLanes: (string | null)[];
}

/**
 * Compute lane assignments for a list of commits in newest-first order.
 *
 * Algorithm: walk top-down, maintaining a sparse array of "active" lanes where each
 * cell holds the sha that lane is currently waiting to encounter (i.e., a parent of an
 * already-rendered commit). When we render a commit, we:
 *   1. Find the lane already expecting our sha; if none, allocate a fresh lane.
 *   2. Clear all lanes that were expecting this sha (multiple branches can converge here).
 *   3. Assign each parent to a lane: the first parent inherits this commit's lane if
 *      free, otherwise a fresh lane. Additional parents always go to fresh lanes —
 *      unless that parent is already being awaited by some other lane (a merge whose
 *      target is "out there" already), in which case the lanes converge later.
 */
export function layoutGraph(commits: CommitLike[]): GraphNode[] {
  const active: (string | null)[] = [];
  const nodes: GraphNode[] = [];

  const findFreeLane = (): number => {
    for (let i = 0; i < active.length; i++) {
      if (active[i] === null) return i;
    }
    active.push(null);
    return active.length - 1;
  };

  for (const commit of commits) {
    let laneIdx = active.findIndex((s) => s === commit.sha);
    if (laneIdx === -1) laneIdx = findFreeLane();

    const inLanes = active.slice();

    // Consume every lane that was waiting for this sha (multiple converging refs).
    for (let i = 0; i < active.length; i++) {
      if (active[i] === commit.sha) active[i] = null;
    }

    for (let i = 0; i < commit.parents.length; i++) {
      const parent = commit.parents[i]!;
      if (active.includes(parent)) continue;
      if (i === 0 && active[laneIdx] === null) {
        active[laneIdx] = parent;
      } else {
        active[findFreeLane()] = parent;
      }
    }

    // Trim trailing nulls so subsequent rows stay narrow when lanes close.
    while (active.length > 0 && active[active.length - 1] === null) active.pop();

    nodes.push({
      sha: commit.sha,
      parents: commit.parents,
      laneIdx,
      inLanes,
      outLanes: active.slice(),
    });
  }

  return nodes;
}

export function maxLaneCount(nodes: GraphNode[]): number {
  let max = 1;
  for (const n of nodes) {
    if (n.inLanes.length > max) max = n.inLanes.length;
    if (n.outLanes.length > max) max = n.outLanes.length;
    if (n.laneIdx + 1 > max) max = n.laneIdx + 1;
  }
  return max;
}
