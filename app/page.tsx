import { auth } from "@/lib/auth";
import TabShell from "@/components/layout/TabShell";
import LoginPanel from "@/components/LoginPanel";

// Render the dashboard for authenticated users, the sign-in panel for
// everyone else. Always returns 200 (no redirect) so the platform's health
// check on / passes.
export default async function Home() {
  const session = await auth();
  return session ? <TabShell /> : <LoginPanel />;
}
