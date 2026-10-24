import type { Metadata } from "next";
import { RadioSayPage } from "@/components/NewsSay";

export const metadata: Metadata = { robots: { index: false, follow: false } };

// Every line of a radio episode, said back three times, from the line ?i= (0-based) on.
export default async function RadioSayRoute({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ i?: string }> }) {
  const [{ id }, { i }] = await Promise.all([params, searchParams]);
  return <RadioSayPage id={id} from={Number(i) || 0} />;
}
