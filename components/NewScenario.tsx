"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { addCustom, type CustomScenario } from "@/lib/client/progress";

const IDEAS = {
  work: ["向上司请教不懂的地方", "会议上提出不同意见", "跟客户电话确认需求", "延迟交付要道歉", "新人自我介绍", "约同事一起吃午饭"],
  life: ["在区役所办住民票", "手机合约解约", "便利店寄快递", "租房看房问条件", "理发店说想要的发型", "跟邻居打招呼闲聊"],
};

export default function NewScenario() {
  const router = useRouter();
  const [category, setCategory] = useState<"work" | "life">("work");
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function generate() {
    if (!topic.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, category }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "生成失败");
      const s = data as CustomScenario;
      addCustom(s);
      router.push(`/s/${s.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
      setBusy(false);
    }
  }

  return (
    <main>
      <Link href="/scenes" className="muted">← 场景</Link>
      <h1>生成新场景</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        写一句你想练的情况，中文日文都行。越具体越好，比如「跟课长说明为什么测试延期了」。
      </p>
      <div className="card">
        <div className="seg">
          <button className={category === "work" ? "on" : ""} onClick={() => setCategory("work")}>职场</button>
          <button className={category === "life" ? "on" : ""} onClick={() => setCategory("life")}>生活</button>
        </div>
        <textarea
          rows={3}
          style={{ marginTop: 12 }}
          value={topic}
          maxLength={200}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="想练什么场景？"
        />
        <div className="suggest">
          {IDEAS[category].map((idea) => (
            <button key={idea} onClick={() => setTopic(idea)}>
              {idea}
            </button>
          ))}
        </div>
        <button className="primary next-cta" onClick={generate} disabled={!topic.trim() || busy}>
          {busy ? "AI 正在写对话，大约半分钟…" : "生成"}
        </button>
        {error && <p className="error">{error}</p>}
      </div>
      <p className="small-text">生成的场景会有对话、读音、中文和配音，也能和 AI 角色扮演，跟内置场景一样计入进度。</p>
    </main>
  );
}
