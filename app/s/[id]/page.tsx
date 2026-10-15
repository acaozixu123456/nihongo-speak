import { getScenario } from "@/content/scenarios";
import ScenarioView, { CustomScenarioView } from "@/components/ScenarioView";
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
  const initial = STEPS.find((s) => s === step);
  const scenario = getScenario(id);
  // AI-written scenarios are stored on the phone, so they are looked up in the browser.
  if (!scenario) return <CustomScenarioView key={initial} id={id} step={initial} />;
  return <ScenarioView key={initial} scenario={scenario} step={initial} />;
}
