import Episode from "@/components/Episode";

export default async function EpisodePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Episodes live in the learner's progress on the phone, so they are looked up in the browser.
  return <Episode id={id} />;
}
