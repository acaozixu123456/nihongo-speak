import { notFound } from "next/navigation";
import { getScenario } from "@/content/scenarios";
import ScenarioView from "@/components/ScenarioView";
import type { Step } from "@/lib/client/progress";

const STEPS: Step[] = ["listen", "shadow", "talk"];

export default async function ScenarioPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
  const { id } = await params;
  const { step } = await searchParams;
  const scenario = getScenario(id);
  if (!scenario) notFound();
  const initial = STEPS.find((s) => s === step);
  return <ScenarioView key={initial} scenario={scenario} step={initial} />;
}
