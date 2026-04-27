import { describe, it, expect } from 'vitest';
import { layoutGraph, maxLaneCount } from '../src/lib/graphLayout';

describe('layoutGraph', () => {
  it('lays a linear history on a single lane', () => {
    const nodes = layoutGraph([
      { sha: 'a', parents: ['b'] },
      { sha: 'b', parents: ['c'] },
      { sha: 'c', parents: [] },
    ]);
    expect(nodes.map((n) => n.laneIdx)).toEqual([0, 0, 0]);
    expect(maxLaneCount(nodes)).toBe(1);
    expect(nodes[2]!.outLanes).toEqual([]);
  });

  it('opens a second lane on a branch and closes it on the merge below', () => {
    // A is a merge of B (first parent) and C (second parent). Both B and C share parent D.
    //
    //   A      <- merge of B, C
    //  / \
    // B   C
    //  \ /
    //   D
    const nodes = layoutGraph([
      { sha: 'A', parents: ['B', 'C'] },
      { sha: 'B', parents: ['D'] },
      { sha: 'C', parents: ['D'] },
      { sha: 'D', parents: [] },
    ]);
    const lanes = nodes.map((n) => n.laneIdx);
    expect(lanes[0]).toBe(0); // A on lane 0
    expect(lanes[1]).toBe(0); // B inherits A's lane (first parent)
    expect(lanes[2]).toBe(1); // C took the new lane allocated for the second parent
    expect(lanes[3]).toBe(0); // D back on lane 0 (only one lane survives by then)
    expect(maxLaneCount(nodes)).toBe(2);
  });

  it('handles two independent tips by allocating separate lanes', () => {
    const nodes = layoutGraph([
      { sha: 'X', parents: ['Y'] },
      { sha: 'P', parents: ['Q'] },
      { sha: 'Y', parents: [] },
      { sha: 'Q', parents: [] },
    ]);
    expect(nodes[0]!.laneIdx).toBe(0);
    expect(nodes[1]!.laneIdx).toBe(1);
    expect(maxLaneCount(nodes)).toBe(2);
  });

  it('inLanes mark this commit\'s arrival lane and outLanes carry parents forward', () => {
    const nodes = layoutGraph([
      { sha: 'A', parents: ['B', 'C'] },
      { sha: 'B', parents: ['D'] },
      { sha: 'C', parents: ['D'] },
      { sha: 'D', parents: [] },
    ]);
    // Row B: incoming has B at lane 0 and C at lane 1
    expect(nodes[1]!.inLanes).toEqual(['B', 'C']);
    expect(nodes[1]!.outLanes).toEqual(['D', 'C']);
    // Row C: D was already expected at lane 0, so the second-parent assignment is skipped — lane 1 closes
    expect(nodes[2]!.inLanes).toEqual(['D', 'C']);
    expect(nodes[2]!.outLanes).toEqual(['D']);
  });

  it('reuses a freed lane slot before extending', () => {
    const nodes = layoutGraph([
      { sha: 'A', parents: ['B', 'C'] },
      { sha: 'B', parents: ['D'] },
      { sha: 'C', parents: ['D'] },
      { sha: 'D', parents: ['E', 'F'] },
      { sha: 'E', parents: ['G'] },
      { sha: 'F', parents: ['G'] },
      { sha: 'G', parents: [] },
    ]);
    expect(maxLaneCount(nodes)).toBe(2); // never needs a 3rd lane
  });
});
