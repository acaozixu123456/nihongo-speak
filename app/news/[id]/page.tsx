import type { Metadata } from "next";
import { NewsArticlePage } from "@/components/News";

export const metadata: Metadata = { robots: { index: false, follow: false } };

// Articles live on the phone (fetched from /api/news), so they are looked up in the browser.
export default async function NewsArticleRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <NewsArticlePage id={id} />;
}
