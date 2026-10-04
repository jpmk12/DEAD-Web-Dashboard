"use client";

import { useState } from "react";

interface AddAccountButtonProps {
  connected: boolean;
  /** The signed-in (primary) account — shown beside the secondary so a swap
   *  or a duplicate is visible at a glance instead of being inferred from
   *  which mail appears. */
  primaryEmail?: string;
  secondaryEmail?: string;
  onRevoked: () => void;
}

export default function AddAccountButton({ connected, primaryEmail, secondaryEmail, onRevoked }: AddAccountButtonProps) {
  const [revoking, setRevoking] = useState(false);

  const handleRevoke = async (e: React.MouseEvent) => {
    e.preventDefault();
    setRevoking(true);
    await fetch("/api/auth/gmail-secondary?step=revoke", { method: "POST" });
    setRevoking(false);
    onRevoked();
  };

  const primary = primaryEmail ? (
    <span className="text-xs text-slate-500 font-mono" title="Primary (signed-in) account">
      <span className="text-slate-400">{primaryEmail}</span>
    </span>
  ) : null;

  if (connected) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        {primary}
        <span className="text-xs text-slate-500 font-mono" title="Second account">
          + <span className="text-slate-400">{secondaryEmail}</span>
        </span>
        <button
          onClick={handleRevoke}
          disabled={revoking}
          className="text-xs text-red-500 hover:text-red-400 disabled:opacity-50 transition-colors"
        >
          {revoking ? "Removing…" : "Remove"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {primary}
      <a
        href="/api/auth/gmail-secondary?step=initiate"
        className="text-xs text-green-500 hover:text-green-400 font-mono transition-colors"
      >
        + Add second Gmail
      </a>
    </div>
  );
}
