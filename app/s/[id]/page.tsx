import { notFound } from "next/navigation";
import { getScenario } from "@/content/scenarios";
import ScenarioView from "@/components/ScenarioView";

export default async function ScenarioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const scenario = getScenario(id);
  if (!scenario) notFound();
  return <ScenarioView scenario={scenario} />;
}
