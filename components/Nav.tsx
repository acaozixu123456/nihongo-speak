"use client";

import Link from "next/link";
import { dueCards, useProgress } from "@/lib/client/progress";

export default function Nav({ on }: { on: "today" | "review" }) {
  const due = dueCards(useProgress()).length;
  return (
    <nav className="nav">
      <Link href="/" className={on === "today" ? "on" : ""}>
        <b>🏠</b>今天
      </Link>
      <Link href="/review" className={on === "review" ? "on" : ""}>
        <b>🃏</b>复习
        {due > 0 && <span className="badge">{due}</span>}
      </Link>
    </nav>
  );
}
