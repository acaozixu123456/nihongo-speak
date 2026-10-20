import type { Metadata } from "next";
import { NewsPlay } from "@/components/News";

export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function NewsPage() {
  return <NewsPlay />;
}
