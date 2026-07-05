// Deterministic concentric-ring layout for the Docs local graph. PURE —
// client-imported, unit-tested; no node:*, no fetch. Deliberately NOT
// force-directed: at personal-wiki scale rings read just as well, cost no
// dependency, never jiggle, and the same doc always lays out the same way.

export interface GraphNode {
  id: string;
  title: string;
  docType: string;
  depth: 0 | 1 | 2;
}

export interface GraphEdge {
  from: string;
  to: string;
  relation: string | null;
  note: string | null;
}

export interface PlacedNode extends GraphNode {
  x: number;
  y: number;
  r: number; // node radius
}

// Place the depth-0 node at centre, depth-1 on an inner ring (even spacing,
// stable title order), depth-2 on an outer ring ordered by the angle of
// their first depth-1 neighbour so families stay adjacent.
export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[], width: number, height: number): PlacedNode[] {
  const cx = width / 2;
  const cy = height / 2;
  const R1 = Math.min(width, height) * 0.30;
  const R2 = Math.min(width, height) * 0.46;

  const byTitle = (a: GraphNode, b: GraphNode) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
  const centre = nodes.filter((n) => n.depth === 0);
  const ring1 = nodes.filter((n) => n.depth === 1).sort(byTitle);
  const ring2 = nodes.filter((n) => n.depth === 2).sort(byTitle);

  const placed: PlacedNode[] = [];
  for (const c of centre) placed.push({ ...c, x: cx, y: cy, r: 17 });

  const angleOf = new Map<string, number>();
  ring1.forEach((n, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, ring1.length);
    angleOf.set(n.id, a);
    placed.push({ ...n, x: cx + R1 * Math.cos(a), y: cy + R1 * Math.sin(a), r: 12 });
  });

  // Desired angle for a ring-2 node = angle of its first placed neighbour.
  const desired = ring2.map((n) => {
    const e = edges.find(
      (ed) => (ed.from === n.id && angleOf.has(ed.to)) || (ed.to === n.id && angleOf.has(ed.from))
    );
    const a = e ? angleOf.get(e.from === n.id ? e.to : e.from)! : -Math.PI / 2;
    return { n, a };
  });
  desired.sort((x, y) => x.a - y.a || byTitle(x.n, y.n));
  desired.forEach(({ n }, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / Math.max(1, desired.length);
    placed.push({ ...n, x: cx + R2 * Math.cos(a), y: cy + R2 * Math.sin(a), r: 8 });
  });

  return placed;
}
