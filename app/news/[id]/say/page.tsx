import type { Metadata } from "next";
import { NewsSayPage } from "@/components/NewsSay";

export const metadata: Metadata = { robots: { index: false, follow: false } };

// 一文ずつ三回話す, from the sentence ?i= (0-based) on.
export default async function NewsSayRoute({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ i?: string }> }) {
  const [{ id }, { i }] = await Promise.all([params, searchParams]);
  return <NewsSayPage id={id} from={Number(i) || 0} />;
}
