"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { addCustom, type CustomScenario } from "@/lib/client/progress";

const IDEAS = {
  work: ["外国客人问有没有大一号，我只会说「Wait」", "客人想退货，我不知道怎么解释规定", "客人问免税怎么办，我答不上来", "店长让我用英语给新同事讲注意事项"],
  life: ["在国外餐厅点菜，服务员问我怎么做牛排", "酒店前台说房间还没准备好", "外国朋友约我周末出去，我不知道怎么回", "在机场转机，不知道去哪个登机口"],
};

// Shrinks a photo to at most 1280px on the long side, as JPEG, so it uploads quickly.
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("读不了这张图片"));
      i.src = url;
    });
    const k = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

// 重来一次: say what happened (or snap a photo) and the AI rebuilds that moment as a scenario to practise.
export default function NewScenario(props: { topic?: string; category?: "work" | "life" }) {
  const router = useRouter();
  const [category, setCategory] = useState<"work" | "life">(props.category ?? "work");
  const [topic, setTopic] = useState(props.topic ?? "");
  const [photo, setPhoto] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null);

  async function pick(f?: File) {
    if (!f) return;
    setError("");
    try {
      setPhoto(await shrink(f));
    } catch (e) {
      setError(e instanceof Error ? e.message : "读不了这张图片");
    }
  }

  async function generate() {
    if ((!topic.trim() && !photo) || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, category, photo }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "生成失败");
      const s = data as CustomScenario;
      addCustom(s);
      router.push(`/s/${s.id}?step=shadow`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
      setBusy(false);
    }
  }

  return (
    <main>
      <Link href="/scenes" className="back">← 场景对话</Link>
      <header className="page-mast">
        <div>
          <h1>重来一次</h1>
          <p className="muted">把今天没说出来的话，变成场景再练一次</p>
        </div>
      </header>
      <div className="card">
        <div className="seg">
          <button className={category === "work" ? "on" : ""} onClick={() => setCategory("work")}>职场</button>
          <button className={category === "life" ? "on" : ""} onClick={() => setCategory("life")}>生活</button>
        </div>
        <textarea
          rows={3}
          style={{ marginTop: 12 }}
          value={topic}
          maxLength={500}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="发生了什么？哪句话没说出来？中文就行"
        />
        <input ref={file} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
        {photo ? (
          <div className="photo-pick">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo} alt="照片" />
            <button className="small" onClick={() => setPhoto(null)}>去掉</button>
          </div>
        ) : (
          <button style={{ width: "100%", marginTop: 10 }} onClick={() => file.current?.click()}>
            选照片
          </button>
        )}
        <div className="suggest">
          {IDEAS[category].map((idea) => (
            <button key={idea} onClick={() => setTopic(idea)}>
              {idea}
            </button>
          ))}
        </div>
        <button className="primary next-cta" onClick={generate} disabled={(!topic.trim() && !photo) || busy}>
          {busy ? "AI 正在还原现场，大约半分钟…" : "重来"}
        </button>
        {error && <p className="error">{error}</p>}
      </div>
      <p className="small-text">
        AI 会写出这个场合的对话（包括你当时没说出来的那句），配上中文和配音，然后直接进入跟读和对话。场景会留在「场景 · 我的」里。
      </p>
    </main>
  );
}
