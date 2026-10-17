import EpisodeCall from "@/components/EpisodeCall";

export default async function EpisodeCallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EpisodeCall id={id} />;
}
