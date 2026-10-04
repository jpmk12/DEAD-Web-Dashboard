"use client";

import { useEffect, useRef } from "react";
import { useSession } from "next-auth/react";

// Once per page load, after the session is known, tell the server which
// account is the primary on this device (POST /api/auth/primary-hint sets an
// httpOnly cookie). The login page reads that cookie to name the account to
// Google, so a weekly re-sign-in cannot silently land on the secondary Gmail.
export default function PrimaryHintSync() {
  const { status, data } = useSession();
  const sent = useRef<string | null>(null);

  useEffect(() => {
    if (status !== "authenticated") return;
    const email = data?.user?.email ?? "";
    if (!email || sent.current === email) return;
    sent.current = email;
    fetch("/api/auth/primary-hint", { method: "POST", cache: "no-store" }).catch(() => {});
  }, [status, data?.user?.email]);

  return null;
}
