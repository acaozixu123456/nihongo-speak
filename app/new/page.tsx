import NewScenario from "@/components/NewScenario";

export default async function NewPage({ searchParams }: { searchParams: Promise<{ topic?: string; cat?: string }> }) {
  const { topic, cat } = await searchParams;
  return <NewScenario topic={typeof topic === "string" ? topic : ""} category={cat === "life" ? "life" : "work"} />;
}
