"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

// A blank panel is the one failure mode this app is not allowed to have.
//
// Every data surface here already obeys "UNKNOWN is not clear" — a dead feed
// says UNKNOWN rather than implying quiet. A React exception broke that rule
// from underneath: React unmounts the throwing subtree, so one bad row in one
// layer replaced a whole pane with empty space and NO statement that anything
// had failed. The user reads that as "the map isn't displaying" and has no way
// to tell a render crash from an empty world.
//
// This boundary makes the crash say so, names it, and offers a retry that
// remounts the subtree (a genuinely transient data shape recovers on the next
// poll). It deliberately does NOT swallow quietly: the error is also logged so
// the browser console still carries the stack.

interface Props {
  children: ReactNode;
  /** What broke, in the user's words — e.g. "Crisis map". */
  label: string;
  /** Height reservation so the surrounding layout doesn't jump. */
  minHeight?: string;
}

interface State {
  error: Error | null;
  /** Bumped on retry to remount children with fresh state. */
  attempt: number;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.label}] render error:`, error, info.componentStack);
  }

  private retry = () => {
    this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));
  };

  render() {
    const { error, attempt } = this.state;
    if (!error) {
      // `key` is what makes retry real — without it React reuses the same
      // instances and a component that crashed in its constructor/effect just
      // crashes again on the same state.
      return <div key={attempt} className="contents">{this.props.children}</div>;
    }

    return (
      <div
        className="border border-red-500/40 bg-red-500/5 rounded-xl p-4 flex flex-col items-center justify-center gap-2 text-center"
        style={{ minHeight: this.props.minHeight ?? "220px" }}
      >
        <p className="text-[11px] font-bold uppercase tracking-widest text-red-400">
          {this.props.label} failed to render
        </p>
        <p className="text-[11.5px] text-slate-400 max-w-md leading-snug">
          This is a fault in the panel, not a quiet picture — nothing here should be
          read as &ldquo;all clear&rdquo;.
        </p>
        <p className="text-[10px] font-mono text-slate-600 max-w-md break-words">
          {error.message || String(error)}
        </p>
        <button
          onClick={this.retry}
          className="mt-1 text-[10px] font-bold uppercase tracking-wider rounded px-3 py-1.5 border border-slate-600 text-slate-300 hover:bg-slate-700/50 transition-colors"
        >
          ↻ Retry
        </button>
      </div>
    );
  }
}
