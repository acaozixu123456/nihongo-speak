import Episode, { NewEpisode } from "@/components/Episode";

export default async function EpisodePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Today's route can start on an episode still being written: wait for it here, then open it.
  if (id === "new") return <NewEpisode />;
  // Episodes live in the learner's progress on the phone, so they are looked up in the browser.
  return <Episode id={id} />;
}
