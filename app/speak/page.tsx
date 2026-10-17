import { redirect } from "next/navigation";

// 話す is now a stop on 今日's route; old links land there.
export default function SpeakPage() {
  redirect("/");
}
