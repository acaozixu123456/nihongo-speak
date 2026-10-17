import Link from "next/link";
import { WeakList } from "@/components/WeakList";

export default function WeakPage() {
  return (
    <main>
      <Link href="/" className="back">← 今日</Link>
      <header className="page-mast">
        <h1>苦手</h1>
      </header>
      <WeakList />
    </main>
  );
}
