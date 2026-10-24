import type { Metadata } from "next";
import { NewsFullPage } from "@/components/NewsFull";

export const metadata: Metadata = { robots: { index: false, follow: false } };

// 全文モード: the whole article said from its Chinese, once every sentence was passed one by one.
export default async function NewsFullRoute({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <NewsFullPage id={id} />;
}
