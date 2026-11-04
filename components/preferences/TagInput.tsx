"use client";

import { useState, KeyboardEvent } from "react";

// Split out of components/PreferencesDrawer.tsx (housekeeping 2026-11-04).

export default function TagInput({
  label,
  description,
  tags,
  onChange,
  placeholder,
  accent = "emerald",
}: {
  label: string;
  description?: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder: string;
  accent?: "emerald" | "orange" | "red";
}) {
  const [input, setInput] = useState("");

  const add = () => {
    const trimmed = input.trim();
    if (trimmed && !tags.includes(trimmed)) onChange([...tags, trimmed]);
    setInput("");
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
    if (e.key === "Backspace" && !input && tags.length) onChange(tags.slice(0, -1));
  };

  const tagColors = {
    emerald: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    orange:  "bg-orange-500/15 text-orange-300 border-orange-500/30",
    red:     "bg-red-500/10 text-red-400 border-red-500/20",
  };

  return (
    <div className="mb-5">
      <label className="block text-xs font-bold uppercase tracking-widest text-slate-400 mb-1">{label}</label>
      {description && <p className="text-[10px] text-slate-600 mb-2">{description}</p>}
      <div className="flex flex-wrap gap-1.5 p-2.5 bg-slate-800/70 border border-slate-700/80 rounded-lg min-h-[44px] focus-within:border-slate-500 transition-colors">
        {tags.map((tag) => (
          <span key={tag} className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-md border ${tagColors[accent]}`}>
            {tag}
            <button
              onClick={() => onChange(tags.filter((t) => t !== tag))}
              className="opacity-60 hover:opacity-100 transition-opacity leading-none"
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={add}
          placeholder={tags.length === 0 ? placeholder : ""}
          className="flex-1 min-w-[100px] bg-transparent text-xs text-slate-200 placeholder-slate-600 outline-none"
        />
      </div>
      <p className="text-[10px] text-slate-500 mt-1">Enter or comma to add · Backspace to remove last</p>
    </div>
  );
}
