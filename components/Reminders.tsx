"use client";

import { useEffect, useState } from "react";

type Slot = "noon" | "evening";
const SLOTS: { key: Slot; label: string; detail: string }[] = [
  { key: "noon", label: "午休提醒", detail: "12 点左右" },
  { key: "evening", label: "晚上提醒", detail: "20 点左右" },
];

function keyBytes(base64url: string) {
  const s = atob(base64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((base64url.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

type Info = { storage: boolean; publicKey?: string; endpoint?: string | null; slots?: Slot[] };

export default function Reminders() {
  const [info, setInfo] = useState<Info | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [support, setSupport] = useState<"ok" | "install" | "no">("ok");

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) setSupport(standalone ? "no" : "install");
    else if (!standalone && /iPhone|iPad/.test(navigator.userAgent)) setSupport("install");

    (async () => {
      const res = await fetch("/api/push");
      const data = (await res.json()) as Info;
      setInfo(data);
      if (!data.endpoint || !("serviceWorker" in navigator)) return;
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager.getSubscription();
      // Only show reminders as on if this phone is the one subscribed.
      if (sub?.endpoint === data.endpoint) setSlots(data.slots ?? []);
    })().catch(() => setInfo({ storage: false }));
  }, []);

  async function toggle(slot: Slot) {
    if (!info?.publicKey) return;
    const next = slots.includes(slot) ? slots.filter((s) => s !== slot) : [...slots, slot];
    setBusy(true);
    setMsg("");
    try {
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register("/sw.js"));
      if (next.length === 0) {
        await fetch("/api/push", { method: "DELETE" });
        await (await reg.pushManager.getSubscription())?.unsubscribe();
        setSlots([]);
        return;
      }
      if ((await Notification.requestPermission()) !== "granted") {
        setMsg("没有通知权限。到 iPhone 设置 → 通知 → 日语练习 里打开。");
        return;
      }
      await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(info.publicKey) }));
      const first = slots.length === 0;
      const res = await fetch("/api/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON(), slots: next, test: first }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "设置失败");
      setSlots(next);
      if (first) setMsg("已经发了一条测试通知，收到就说明设置好了。");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "设置失败");
    } finally {
      setBusy(false);
    }
  }

  if (!info) return <p className="muted">加载中…</p>;
  if (!info.storage) return <p className="muted">需要先开通云端存储才能使用提醒。</p>;
  if (support === "install") {
    return (
      <p className="muted" style={{ margin: 0 }}>
        iPhone 只给主屏幕上的应用发通知。在 Safari 里点分享按钮 →「添加到主屏幕」，再从主屏幕图标打开这里设置。
      </p>
    );
  }
  if (support === "no") return <p className="muted">这个浏览器不支持通知。</p>;

  return (
    <div>
      {SLOTS.map((s) => (
        <div key={s.key} className="toggle">
          <div>
            <div>{s.label}</div>
            <div className="small-text">{s.detail}</div>
          </div>
          <button
            className={`switch ${slots.includes(s.key) ? "on" : ""}`}
            aria-pressed={slots.includes(s.key)}
            aria-label={s.label}
            disabled={busy}
            onClick={() => toggle(s.key)}
          />
        </div>
      ))}
      {msg && <p className="small-text" style={{ marginBottom: 0 }}>{msg}</p>}
    </div>
  );
}
