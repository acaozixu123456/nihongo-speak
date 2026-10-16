import { redirect } from "next/navigation";

// The buildings were merged into one scenario list.
export default async function BuildingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/scenes?tab=${encodeURIComponent(id)}`);
}
