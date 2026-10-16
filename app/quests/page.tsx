import { redirect } from "next/navigation";

// Daily quests now live in 今日训练.
export default function QuestsPage() {
  redirect("/train");
}
