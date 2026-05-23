"use client";

import { useState } from "react";

interface AddAccountButtonProps {
  connected: boolean;
  secondaryEmail?: string;
  onRevoked: () => void;
}

export default function AddAccountButton({ connected, secondaryEmail, onRevoked }: AddAccountButtonProps) {
  const [revoking, setRevoking] = useState(false);

  const handleRevoke = async (e: React.MouseEvent) => {
    e.preventDefault();
    setRevoking(true);
    await fetch("/api/auth/gmail-secondary?step=revoke", { method: "POST" });
    setRevoking(false);
    onRevoked();
  };

  if (connected) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-500 font-mono">
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
    <a
      href="/api/auth/gmail-secondary?step=initiate"
      className="text-xs text-green-500 hover:text-green-400 font-mono transition-colors"
    >
      + Add second Gmail
    </a>
  );
}
