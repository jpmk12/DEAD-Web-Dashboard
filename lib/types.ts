export interface NewsItem {
  id: string;
  title: string;
  source: string;
  category: string; // "overview" | "defense" | "strategic" | "domestic" | "space" | "local"
  pubDate: string;
  summary: string;
  link: string;
  imageUrl?: string;
}
