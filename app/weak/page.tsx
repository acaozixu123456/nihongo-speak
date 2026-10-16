import { redirect } from "next/navigation";

// Weak points now live in 今日训练.
export default function WeakPage() {
  redirect("/train#weak");
}
