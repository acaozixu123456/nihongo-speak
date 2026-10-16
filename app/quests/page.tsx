import { redirect } from "next/navigation";

// Daily quests were folded into the home page.
export default function QuestsPage() {
  redirect("/");
}
