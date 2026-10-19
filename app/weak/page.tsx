import Link from "next/link";
import { WeakList } from "@/components/WeakList";

export default function WeakPage() {
  return (
    <main>
      <Link href="/me" className="back">← 先生</Link>
      <header className="page-mast">
        <h1>苦手</h1>
      </header>
      <WeakList />
    </main>
  );
}
