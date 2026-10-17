import Link from "next/link";
import { WeakList } from "@/components/WeakList";

export default function WeakPage() {
  return (
    <main>
      <Link href="/me" className="back">← 我</Link>
      <header className="page-mast">
        <h1>薄弱点</h1>
      </header>
      <WeakList />
    </main>
  );
}
