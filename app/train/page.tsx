import { redirect } from "next/navigation";

// Today's training is the home page now.
export default function TrainPage() {
  redirect("/");
}
