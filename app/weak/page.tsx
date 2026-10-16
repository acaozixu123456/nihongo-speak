import Link from "next/link";
import Nav from "@/components/Nav";
import { WeakList } from "@/components/WeakList";

export default function WeakPage() {
  return (
    <main>
      <Link href="/me" className="back">← 我</Link>
      <header className="page-mast">
        <div>
          <h1>薄弱点</h1>
          <p className="muted">AI 从你每次开口里找出的、反复出错的语法和说法</p>
        </div>
      </header>
      <WeakList />
      <Nav on="me" />
    </main>
  );
}
