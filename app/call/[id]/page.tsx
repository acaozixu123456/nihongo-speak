import { notFound } from "next/navigation";
import Call from "@/components/Call";
import { findCall } from "@/content/calls";

export default async function CallPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const call = findCall(id);
  if (!call) notFound();
  return <Call call={call} />;
}
