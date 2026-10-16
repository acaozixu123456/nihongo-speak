import Scenes from "@/components/Scenes";
import type { BuildingId } from "@/lib/client/game";

const IDS: BuildingId[] = ["work", "life", "custom"];

export default async function ScenesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return <Scenes tab={IDS.find((x) => x === tab)} />;
}
