import Quick from "@/components/Quick";

export default async function QuickPage({ searchParams }: { searchParams: Promise<{ drill?: string | string[] }> }) {
  const { drill } = await searchParams;
  const tag = typeof drill === "string" ? drill : undefined;
  return <Quick key={tag ?? ""} drill={tag} />;
}
