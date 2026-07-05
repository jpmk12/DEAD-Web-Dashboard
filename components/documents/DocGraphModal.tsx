"use client";

import { useEffect, useMemo, useState } from "react";
import { layoutGraph, type GraphEdge, type GraphNode, type PlacedNode } from "@/lib/docGraph";
import { docTypeMeta, DOC_TYPES } from "@/lib/docTypes";
import { RELATION_HEX, RELATION_GLYPHS, type LinkRelation } from "@/lib/linkRelations";

interface DocGraphModalProps {
  docId: string;
  onClose: () => void;
  onOpenDoc: (id: string) => void;
}

const W = 820;
const H = 540;

function edgeColor(rel: string | null): string {
  if (rel && rel in RELATION_HEX) return RELATION_HEX[rel as LinkRelation];
  return "#64748b";
}

// Local link-neighbourhood graph: centre doc, ring 1 = direct links, ring 2 =
// their links (dimmed). Node ring colour = doc type, edge colour = relation.
// Click opens a doc; double-click re-centres the graph on it.
export default function DocGraphModal({ docId, onClose, onOpenDoc }: DocGraphModalProps) {
  const [centerId, setCenterId] = useState(docId);
  const [depth, setDepth] = useState<1 | 2>(1);
  const [labels, setLabels] = useState(true);
  const [data, setData] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [hoverId, setHoverId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/documents/graph?id=${centerId}&depth=${depth}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setData(d.nodes ? { nodes: d.nodes, edges: d.edges ?? [] } : null);
      })
      .catch(() => { if (!cancelled) setData(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [centerId, depth]);

  const placed = useMemo(
    () => (data ? layoutGraph(data.nodes, data.edges, W, H) : []),
    [data]
  );
  const byId = useMemo(() => new Map(placed.map((n) => [n.id, n])), [placed]);

  const hovered = hoverId ? byId.get(hoverId) : null;
  const hoveredEdges = useMemo(() => {
    if (!hoverId || !data) return [];
    return data.edges
      .filter((e) => e.from === hoverId || e.to === hoverId)
      .map((e) => {
        const otherId = e.from === hoverId ? e.to : e.from;
        return { other: byId.get(otherId)?.title ?? "?", relation: e.relation, note: e.note, out: e.from === hoverId };
      })
      .slice(0, 5);
  }, [hoverId, data, byId]);

  const typesInGraph = useMemo(() => {
    const s = new Set(placed.map((n) => n.docType));
    return DOC_TYPES.filter((t) => s.has(t.key));
  }, [placed]);
  const relationsInGraph = useMemo(() => {
    const s = new Set((data?.edges ?? []).map((e) => e.relation).filter(Boolean));
    return [...s] as LinkRelation[];
  }, [data]);

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-950 border border-slate-700/80 rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl">
        <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-800 flex-shrink-0">
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-300">◉ Graph</h2>
          <span className="text-[10px] text-slate-600 font-mono truncate">
            {byId.get(centerId)?.title ?? "…"} · {placed.length} docs
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            {([1, 2] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDepth(d)}
                className={`text-[10px] font-bold px-2 py-1 rounded border transition-all ${
                  depth === d ? "border-emerald-500/50 text-emerald-300 bg-emerald-500/10" : "border-slate-700 text-slate-500 hover:text-slate-300"
                }`}
              >
                ±{d} hop{d === 2 ? "s" : ""}
              </button>
            ))}
            <button
              onClick={() => setLabels((v) => !v)}
              className={`text-[10px] font-bold px-2 py-1 rounded border transition-all ${
                labels ? "border-emerald-500/50 text-emerald-300 bg-emerald-500/10" : "border-slate-700 text-slate-500 hover:text-slate-300"
              }`}
            >
              Labels
            </button>
            <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-lg leading-none px-1">×</button>
          </div>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Canvas */}
          <div className="flex-1 min-w-0 relative">
            {loading && <p className="absolute inset-0 flex items-center justify-center text-xs text-slate-500">Walking the link graph…</p>}
            {!loading && placed.length <= 1 && (
              <p className="absolute inset-0 flex items-center justify-center text-xs text-slate-500 px-8 text-center">
                No linked docs yet — add <span className="text-emerald-400 mx-1 font-mono">[[wiki-links]]</span> and the neighbourhood appears here.
              </p>
            )}
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full block" style={{ minHeight: 420 }}>
              {/* edges under nodes */}
              {data?.edges.map((e, i) => {
                const a = byId.get(e.from);
                const b = byId.get(e.to);
                if (!a || !b) return null;
                const dim = a.depth === 2 || b.depth === 2;
                const active = hoverId && (e.from === hoverId || e.to === hoverId);
                return (
                  <line
                    key={i}
                    x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                    stroke={edgeColor(e.relation)}
                    strokeOpacity={active ? 0.95 : dim ? 0.16 : 0.5}
                    strokeWidth={active ? 2.4 : 1.6}
                    strokeDasharray={e.relation ? undefined : "4 5"}
                  />
                );
              })}
              {placed.map((n) => {
                const meta = docTypeMeta(n.docType);
                const active = hoverId === n.id;
                return (
                  <g
                    key={n.id}
                    transform={`translate(${n.x},${n.y})`}
                    className="cursor-pointer"
                    onMouseEnter={() => setHoverId(n.id)}
                    onMouseLeave={() => setHoverId((h) => (h === n.id ? null : h))}
                    onClick={() => { onOpenDoc(n.id); onClose(); }}
                    onDoubleClick={(e) => { e.preventDefault(); setCenterId(n.id); }}
                  >
                    <circle
                      r={n.r + (active ? 2 : 0)}
                      fill="#0b1220"
                      stroke={meta.hex}
                      strokeWidth={n.depth === 0 ? 3 : 2}
                      opacity={n.depth === 2 && !active ? 0.55 : 1}
                    />
                    <text textAnchor="middle" dy="3.5" fontSize={n.depth === 0 ? 11 : 9} fill={meta.hex} fontWeight={700}>
                      {meta.icon}
                    </text>
                    {(labels || n.depth === 0 || active) && n.depth !== 2 && (
                      <text textAnchor="middle" y={n.r + 13} fontSize={n.depth === 0 ? 11.5 : 10} fill={active ? "#f1f5f9" : "#94a3b8"} fontWeight={n.depth === 0 ? 700 : 500}>
                        {n.title.length > 28 ? n.title.slice(0, 27) + "…" : n.title}
                      </text>
                    )}
                    {labels && n.depth === 2 && (
                      <text textAnchor="middle" y={n.r + 11} fontSize={8.5} fill="#64748b" opacity={active ? 1 : 0.7}>
                        {n.title.length > 20 ? n.title.slice(0, 19) + "…" : n.title}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Side rail: legend + hover card */}
          <div className="w-60 flex-shrink-0 border-l border-slate-800 p-3.5 overflow-y-auto">
            {relationsInGraph.length > 0 && (
              <>
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">Edges</p>
                <div className="space-y-1 mb-3">
                  {relationsInGraph.map((r) => (
                    <div key={r} className="flex items-center gap-2 text-[10.5px] text-slate-400">
                      <span className="w-4 h-0.5 rounded" style={{ background: RELATION_HEX[r] }} />
                      {RELATION_GLYPHS[r]} {r}
                    </div>
                  ))}
                  <div className="flex items-center gap-2 text-[10.5px] text-slate-500">
                    <span className="w-4 border-t border-dashed border-slate-500" />
                    plain link
                  </div>
                </div>
              </>
            )}
            {typesInGraph.length > 0 && (
              <>
                <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">Nodes</p>
                <div className="space-y-1 mb-3">
                  {typesInGraph.map((t) => (
                    <div key={t.key} className="flex items-center gap-2 text-[10.5px] text-slate-400">
                      <span className="w-2.5 h-2.5 rounded-full border-2" style={{ borderColor: t.hex }} />
                      {t.icon} {t.label.toLowerCase()}
                    </div>
                  ))}
                </div>
              </>
            )}
            <p className="text-[9px] font-bold uppercase tracking-widest text-slate-500 mb-1.5">
              {hovered ? "Hovered" : "Controls"}
            </p>
            {hovered ? (
              <div className="bg-slate-900/60 border border-slate-800 rounded-lg px-2.5 py-2">
                <p className="text-[11.5px] font-bold text-slate-100 leading-snug">{hovered.title}</p>
                <p className="text-[9.5px] text-slate-500 mb-1">{docTypeMeta(hovered.docType).label}</p>
                {hoveredEdges.map((e, i) => (
                  <p key={i} className="text-[10px] text-slate-400 leading-snug truncate" title={e.note ?? undefined}>
                    {e.out ? "→" : "←"} {e.relation ? `${RELATION_GLYPHS[e.relation as LinkRelation] ?? ""} ` : ""}{e.other}
                  </p>
                ))}
                <p className="text-[9px] text-slate-600 mt-1.5">click = open · double-click = re-centre</p>
              </div>
            ) : (
              <p className="text-[10px] text-slate-600 leading-relaxed">
                Hover a node for its connections. Click opens the doc; double-click re-centres the graph on it.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
