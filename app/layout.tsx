import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { SessionProvider } from "next-auth/react";
import ThemeApplicator from "@/components/ThemeApplicator";
import ToastHost from "@/components/ToastHost";
import AlertHeartbeat from "@/components/AlertHeartbeat";
import PrimaryHintSync from "@/components/PrimaryHintSync";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

// Installable: the manifest + apple-touch-icon make "Add to Home Screen" produce
// a real app tile, and iOS only allows web push for pages opened from one.
// public/sw.js handles push only — it caches nothing (a stale dashboard that
// looks current is worse than a login page).
export const metadata: Metadata = {
  title: "DEAD's Dashboard",
  description: "National security news, calendar, and email — all in one place.",
  applicationName: "DEAD's Dashboard",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "DEAD", statusBarStyle: "black-translucent" },
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }, { url: "/icon-512.png", sizes: "512x512", type: "image/png" }],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180" }],
  },
};

// Mobile: scale to device width, allow user zoom (accessibility), and extend
// under the notch/home-indicator so safe-area insets can be honored in CSS.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#020617", // slate-950, matches the app background
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
          <ToastHost />
          <AlertHeartbeat />
          <PrimaryHintSync />
        </SessionProvider>
      </body>
    </html>
  );
}
