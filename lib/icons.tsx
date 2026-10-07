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
import { Users,
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
  Coins,
  Search,
  Sun,
  Moon,
  Sunrise,
  Sunset,
  FolderHeart,
  X,
  ExternalLink,
  MoreHorizontal,
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
  markets: Coins,
  family: Users,
};

// Economy (Economic Warfare Watch) tab header.
export const EconomyIcon = Coins;

// Primary actions / feature identities.
export const BriefIcon = Sparkles; // Morning Brief + Macro Brief + News Analyst
export const DigestIcon = BookOpen; // weekly reading digest
export const CaptureIcon = Plus; // quick capture
export const SearchIcon = Search; // ⌘K command palette
export const PreferencesIcon = Settings;
export const AssistantIcon = Bot; // floating AI assistant
export const MenuIcon = Menu; // phone hamburger
export const ReachIcon = Globe; // Glance "Global Reach Watch" card

// Glance world clocks — the part of the local day at each place. One glyph
// per phase so a tile reads at a glance: sun = their working day, moon =
// their night, sunrise/sunset = the shoulders.
export const DAY_PHASE_ICONS = { day: Sun, night: Moon, dawn: Sunrise, dusk: Sunset } as const;

// Email → "file under Family" (applies a Gmail label and tracks the sender).
export const FamilyFileIcon = FolderHeart;

// Affordances shared by every modal / drawer / popover. ONE close control:
// a header "close this surface" button is always <CloseIcon>; the inline
// "remove this row" glyph stays the Unicode ✕ so the two never read alike.
export const CloseIcon = X;
// A link that leaves the app (new tab). The ↗ glyph is reserved for the
// I&W "deteriorating" trajectory, so external links carry this instead.
export const ExternalLinkIcon = ExternalLink;
// "More actions" overflow menus.
export const MoreIcon = MoreHorizontal;

// News view-mode toggles.
export const FeedViewIcon = List;
export const ThreadsViewIcon = Network;
export const HistoryViewIcon = History;

// Individual tab icons, re-exported so a tab's in-panel header can match its
// nav icon directly.
export { Gauge, Newspaper, Calendar, Mail, Crosshair, CloudSun, FileText, CandlestickChart };

export type { LucideIcon };
