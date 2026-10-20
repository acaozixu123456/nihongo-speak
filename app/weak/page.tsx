import Link from "next/link";
import { WeakList } from "@/components/WeakList";

export default function WeakPage() {
  return (
    <main>
      <Link href="/me" className="back">← 老师</Link>
      <header className="page-mast">
        <h1>常错的地方</h1>
      </header>
      <WeakList />
    </main>
  );
}
