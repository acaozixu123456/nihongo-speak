import { notFound } from "next/navigation";
import Building from "@/components/Building";
import type { BuildingId } from "@/lib/client/game";

const IDS: BuildingId[] = ["work", "life", "custom"];

export default async function BuildingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const b = IDS.find((x) => x === id);
  if (!b) notFound();
  return <Building key={b} id={b} />;
}
