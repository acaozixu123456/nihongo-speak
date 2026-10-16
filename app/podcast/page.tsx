import { redirect } from "next/navigation";

// The commute podcast now plays inside 摸鱼模式.
export default function PodcastPage() {
  redirect("/moyu");
}
