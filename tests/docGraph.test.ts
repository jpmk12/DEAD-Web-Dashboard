import { describe, it, expect } from "vitest";
import { layoutGraph, type GraphNode, type GraphEdge } from "../lib/docGraph";

const N = (id: string, depth: 0 | 1 | 2, docType = "note"): GraphNode => ({ id, title: id, docType, depth });

describe("layoutGraph", () => {
  const nodes = [N("c", 0), N("a1", 1), N("b1", 1), N("x2", 2), N("y2", 2)];
  const edges: GraphEdge[] = [
    { from: "c", to: "a1", relation: "extends", note: null },
    { from: "b1", to: "c", relation: null, note: null },
    { from: "a1", to: "x2", relation: null, note: null },
    { from: "y2", to: "b1", relation: null, note: null },
  ];

  it("places the centre node mid-canvas and everything exactly once", () => {
    const placed = layoutGraph(nodes, edges, 800, 500);
    expect(placed).toHaveLength(5);
    const c = placed.find((p) => p.id === "c")!;
    expect(c.x).toBe(400);
    expect(c.y).toBe(250);
    expect(new Set(placed.map((p) => p.id)).size).toBe(5);
  });

  it("ring radius grows with depth and node size shrinks", () => {
    const placed = layoutGraph(nodes, edges, 800, 500);
    const dist = (p: { x: number; y: number }) => Math.hypot(p.x - 400, p.y - 250);
    const r1 = placed.filter((p) => p.depth === 1).map(dist);
    const r2 = placed.filter((p) => p.depth === 2).map(dist);
    expect(Math.min(...r2)).toBeGreaterThan(Math.max(...r1));
    expect(placed.find((p) => p.depth === 0)!.r).toBeGreaterThan(placed.find((p) => p.depth === 1)!.r);
    expect(placed.find((p) => p.depth === 1)!.r).toBeGreaterThan(placed.find((p) => p.depth === 2)!.r);
  });

  it("is deterministic — same input, same layout", () => {
    const a = layoutGraph(nodes, edges, 800, 500);
    const b = layoutGraph(nodes, edges, 800, 500);
    expect(a).toEqual(b);
  });

  it("spaces ring-1 nodes apart", () => {
    const placed = layoutGraph(nodes, edges, 800, 500);
    const ring1 = placed.filter((p) => p.depth === 1);
    const d = Math.hypot(ring1[0].x - ring1[1].x, ring1[0].y - ring1[1].y);
    expect(d).toBeGreaterThan(50);
  });
});
