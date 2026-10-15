import Link from "next/link";
import { scenarios } from "@/content/scenarios";

export default function Home() {
  const groups = [
    { key: "work", label: "职场" },
    { key: "life", label: "生活" },
  ] as const;
  return (
    <main>
      <h1>日语听说练习</h1>
      <p className="muted">每个场景按顺序练：先精听，再跟读，最后和 AI 对话。</p>
      {groups.map((g) => (
        <section key={g.key}>
          <h2>{g.label}</h2>
          {scenarios
            .filter((s) => s.category === g.key)
            .map((s) => (
              <Link key={s.id} href={`/s/${s.id}`} style={{ textDecoration: "none" }}>
                <div className="card">
                  <div className="row spread">
                    <strong>{s.title}</strong>
                    <span className="muted">{s.level}</span>
                  </div>
                  <div>{s.titleZh}</div>
                  <div className="muted">{s.summaryZh}</div>
                </div>
              </Link>
            ))}
        </section>
      ))}
    </main>
  );
}
