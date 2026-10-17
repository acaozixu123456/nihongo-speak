import Game from "@/components/Game";

export default async function GamePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Game id={id} />;
}
