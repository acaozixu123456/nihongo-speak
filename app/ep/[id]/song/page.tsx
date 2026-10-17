import SongStop from "@/components/SongStop";

export default async function SongPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <SongStop id={id} />;
}
