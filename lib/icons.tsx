// Central icon vocabulary.
//
// Navigation tabs, primary action buttons, and major feature/section headers
// use lucide SVG icons: crisp on retina, uniquely distinguishable from one
// another, and large enough to tap on a phone. Dense inline markers elsewhere
// (disaster types, weather overlays, severity dots, trend arrows, voting,
// affordances) keep their curated Unicode glyphs.
//
// Keeping the mapping here means one glyph == one meaning, and every call site
// imports from a single source of truth.
import {
  Gauge,
  Newspaper,
  Calendar,
  Mail,
  Crosshair,
  CloudSun,
  FileText,
  CandlestickChart,
  Sparkles,
  BookOpen,
  Plus,
  Settings,
  Bot,
  List,
  Network,
  History,
  Menu,
  Globe,
  type LucideIcon,
} from "lucide-react";

import type { Tab } from "@/components/layout/TabBar";

// One icon per navigation tab.
export const TAB_ICONS: Record<Tab, LucideIcon> = {
  glance: Gauge,
  news: Newspaper,
  calendar: Calendar,
  email: Mail,
  osint: Crosshair,
  weather: CloudSun,
  docs: FileText,
  markets: CandlestickChart,
};

// Primary actions / feature identities.
export const BriefIcon = Sparkles; // Morning Brief + Macro Brief + News Analyst
export const DigestIcon = BookOpen; // weekly reading digest
export const CaptureIcon = Plus; // quick capture (⌘K)
export const PreferencesIcon = Settings;
export const AssistantIcon = Bot; // floating AI assistant
export const MenuIcon = Menu; // phone hamburger
export const ReachIcon = Globe; // Glance "Global Reach Watch" card

// News view-mode toggles.
export const FeedViewIcon = List;
export const ThreadsViewIcon = Network;
export const HistoryViewIcon = History;

// Individual tab icons, re-exported so a tab's in-panel header can match its
// nav icon directly.
export { Gauge, Newspaper, Calendar, Mail, Crosshair, CloudSun, FileText, CandlestickChart };

export type { LucideIcon };
