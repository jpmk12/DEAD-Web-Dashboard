import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { SessionProvider } from "next-auth/react";
import ThemeApplicator from "@/components/ThemeApplicator";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "DEAD's Dashboard",
  description: "National security news, calendar, and email — all in one place.",
};

// Runs before React hydrates to apply the saved theme from localStorage,
// preventing a flash of the default theme on load.
const THEME_SCRIPT = `
  try {
    var t = localStorage.getItem("app-theme");
    if (t === "amber" || t === "arctic" || t === "mission") {
      document.documentElement.setAttribute("data-theme", t);
    }
  } catch(e) {}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="nightwatch">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className={`${inter.className} bg-slate-950 text-slate-100 min-h-screen`}>
        <SessionProvider>
          <ThemeApplicator />
          {children}
        </SessionProvider>
      </body>
    </html>
  );
}
