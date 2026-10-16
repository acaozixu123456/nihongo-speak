import { redirect } from "next/navigation";

// There is no password any more; old bookmarks of the login page go straight in.
export default function LoginPage() {
  redirect("/");
}
