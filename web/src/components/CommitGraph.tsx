import { useMemo } from 'react';
import type { Commit } from '../lib/github';
import { layoutGraph, maxLaneCount, type GraphNode } from '../lib/graphLayout';

const ROW_H = 32;
const LANE_W = 18;
const PADDING_X = 12;
const DOT_R = 6;
const STROKE = 2.25;

const PALETTE = [
  '#34d399', // emerald-400
  '#fb7185', // rose-400
  '#fbbf24', // amber-400
  '#22d3ee', // cyan-400
  '#a78bfa', // violet-400
  '#a3e635', // lime-400
  '#f472b6', // pink-400
  '#818cf8', // indigo-400
];
const laneColor = (i: number) => PALETTE[i % PALETTE.length]!;
const laneX = (i: number) => PADDING_X + i * LANE_W;

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}
function firstLine(msg: string): string {
  const i = msg.indexOf('\n');
  return i === -1 ? msg : msg.slice(0, i);
}

interface RowEdgesProps {
  node: GraphNode;
  rowIdx: number;
  isLastRow: boolean;
}

function RowEdges({ node, rowIdx, isLastRow }: RowEdgesProps) {
  const yTop = rowIdx * ROW_H;
  const yMid = yTop + ROW_H / 2;
  const yBot = yTop + ROW_H;
  const myX = laneX(node.laneIdx);
  const segments: JSX.Element[] = [];
  let key = 0;

  // Top half: incoming flows from the row above to this row's mid line.
  for (let i = 0; i < node.inLanes.length; i++) {
    const sha = node.inLanes[i];
    if (!sha) continue;
    const x = laneX(i);
    const color = laneColor(i);
    if (sha === node.sha) {
      // This lane is converging into this commit (could be `i === node.laneIdx` for a
      // straight arrival, or an off-lane merge target for a sideways converge).
      if (i === node.laneIdx) {
        segments.push(
          <line key={key++} x1={x} y1={yTop} x2={x} y2={yMid} stroke={color} strokeWidth={STROKE} />,
        );
      } else {
        segments.push(
          <path
            key={key++}
            d={`M ${x} ${yTop} C ${x} ${yMid}, ${myX} ${yTop}, ${myX} ${yMid}`}
            stroke={color}
            strokeWidth={STROKE}
            fill="none"
          />,
        );
      }
    } else {
      // Lane just passes through.
      segments.push(
        <line key={key++} x1={x} y1={yTop} x2={x} y2={yMid} stroke={color} strokeWidth={STROKE} />,
      );
    }
  }

  // Bottom half: outgoing flows from this row's mid line to the row below.
  for (let i = 0; i < node.outLanes.length; i++) {
    const sha = node.outLanes[i];
    if (!sha) continue;
    const x = laneX(i);
    const color = laneColor(i);
    const passThrough = node.inLanes[i] && node.inLanes[i] !== node.sha;

    // Fade tail edges on the very last row so dangling lanes (parents not in our
    // 30-commit window) trail off rather than ending abruptly.
    const opacity = isLastRow ? 0.35 : 1;

    if (passThrough) {
      segments.push(
        <line
          key={key++}
          x1={x}
          y1={yMid}
          x2={x}
          y2={yBot}
          stroke={color}
          strokeWidth={STROKE}
          opacity={opacity}
        />,
      );
    } else if (i === node.laneIdx) {
      segments.push(
        <line
          key={key++}
          x1={myX}
          y1={yMid}
          x2={x}
          y2={yBot}
          stroke={color}
          strokeWidth={STROKE}
          opacity={opacity}
        />,
      );
    } else {
      // Diverging diagonal from this commit to a freshly-allocated lane.
      segments.push(
        <path
          key={key++}
          d={`M ${myX} ${yMid} C ${myX} ${yBot}, ${x} ${yMid}, ${x} ${yBot}`}
          stroke={color}
          strokeWidth={STROKE}
          fill="none"
          opacity={opacity}
        />,
      );
    }
  }

  return <>{segments}</>;
}

interface Props {
  commits: Commit[];
  anchorSha: string | null;
  headSha: string | null;
  onSelect: (sha: string) => void;
}

export function CommitGraph({ commits, anchorSha, headSha, onSelect }: Props) {
  const nodes = useMemo(
    () => layoutGraph(commits.map((c) => ({ sha: c.sha, parents: c.parents }))),
    [commits],
  );
  const laneCount = maxLaneCount(nodes);
  const svgWidth = laneX(laneCount - 1) + PADDING_X + DOT_R + 2;
  const svgHeight = nodes.length * ROW_H;

  return (
    <div className="flex">
      <svg
        width={svgWidth}
        height={svgHeight}
        className="flex-shrink-0"
        style={{ minWidth: svgWidth }}
        aria-hidden="true"
      >
        <defs>
          <filter id="dot-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {nodes.map((node, r) => (
          <RowEdges key={`edges-${node.sha}`} node={node} rowIdx={r} isLastRow={r === nodes.length - 1} />
        ))}
        {nodes.map((node, r) => {
          const yMid = r * ROW_H + ROW_H / 2;
          const x = laneX(node.laneIdx);
          const isAnchor = node.sha === anchorSha;
          const isHead = node.sha === headSha;
          const isMerge = node.parents.length > 1;
          const fill = laneColor(node.laneIdx);
          const ring = isAnchor ? '#ffffff' : isHead ? '#60a5fa' : null;
          return (
            <g key={`dot-${node.sha}`}>
              {ring && (
                <circle
                  cx={x}
                  cy={yMid}
                  r={DOT_R + 3.5}
                  fill="none"
                  stroke={ring}
                  strokeWidth={2}
                  opacity={0.95}
                />
              )}
              <circle
                cx={x}
                cy={yMid}
                r={DOT_R}
                fill={fill}
                stroke="#0a0a0a"
                strokeWidth={1.5}
                filter="url(#dot-glow)"
              />
              {isMerge && (
                <circle cx={x} cy={yMid} r={DOT_R - 2.5} fill="#0a0a0a" opacity={0.85} />
              )}
            </g>
          );
        })}
      </svg>

      <ul className="flex-1 min-w-0">
        {commits.map((c, r) => {
          const isAnchor = c.sha === anchorSha;
          const isHead = c.sha === headSha;
          return (
            <li
              key={c.sha}
              onClick={() => onSelect(c.sha)}
              className={`cursor-pointer flex items-center gap-2 px-3 hover:bg-zinc-900/80 ${
                isAnchor ? 'bg-emerald-900/30 hover:bg-emerald-900/40' : ''
              }`}
              style={{ height: ROW_H }}
              title={`${c.sha}\n${c.message}`}
            >
              <span className="font-mono text-xs text-emerald-400 shrink-0">{shortSha(c.sha)}</span>
              {isHead && (
                <span className="text-[10px] uppercase tracking-wide bg-blue-900 text-blue-200 px-1 py-0.5 rounded shrink-0">
                  head
                </span>
              )}
              {isAnchor && (
                <span className="text-[10px] uppercase tracking-wide bg-emerald-800 text-emerald-100 px-1 py-0.5 rounded shrink-0">
                  here
                </span>
              )}
              <span className="text-sm truncate flex-1 min-w-0">{firstLine(c.message)}</span>
              <span className="hidden md:inline text-xs text-zinc-500 shrink-0 max-w-[140px] truncate">
                {c.authorName}
              </span>
              <span className="hidden lg:inline text-xs text-zinc-600 shrink-0">
                {new Date(c.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
