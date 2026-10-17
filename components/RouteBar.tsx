"use client";

import { useRouter, usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { NEW_EP, NEXT, current, finished, nextHref, read, useRoute } from "@/lib/client/route";

const SEE_MS = 1800; // time to look at the result before the next stop is announced
const COUNT = 3;

// On top of whichever page is today's current stop: × back to 今日, and one segment per stop.
// When a page reports its part done, the next stop is announced and opens after 3 seconds.
// After the last stop nothing moves by itself (there may be feedback to read): one button ends the day.
export default function RouteBar() {
  const r = useRoute();
  const router = useRouter();
  const here = usePathname();
  const [pending, setPending] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [waiting, setWaiting] = useState(false);
  const timers = useRef<number[]>([]);
  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  const c = current(r);
  const onStop = !!c && c.href.split("?")[0] === here;
  const show = !!r && (onStop || pending);

  useEffect(() => {
    document.body.classList.toggle("in-route", show);
    return () => document.body.classList.remove("in-route");
  }, [show]);

  useEffect(() => {
    const onNext = () => {
      clear();
      setPending(true);
      if (finished(read())) return;
      timers.current.push(
        window.setTimeout(() => {
          setCount(COUNT);
          for (let i = 1; i <= COUNT; i++) timers.current.push(window.setTimeout(() => setCount(COUNT - i), i * 1000));
        }, SEE_MS),
      );
    };
    window.addEventListener(NEXT, onNext);
    return () => {
      window.removeEventListener(NEXT, onNext);
      clear();
    };
  }, []);

  // Leaving the page any other way drops what was pending.
  useEffect(() => {
    clear();
    setPending(false);
    setCount(null);
    setWaiting(false);
  }, [here]);

  async function go() {
    clear();
    setWaiting(true);
    router.push(await nextHref());
  }

  useEffect(() => {
    if (count === 0 && !waiting) go();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);

  if (!show || !r) return null;
  const up = current(r);
  return (
    <>
      <div className="route-bar">
        <button className="route-x" onClick={() => router.push("/")} aria-label="回到今日">
          ×
        </button>
        <div className="route-segs">
          {r.stops.map((s, i) => (
            <i key={i} className={i < r.at ? "f" : i === r.at ? "c" : ""} />
          ))}
        </div>
      </div>
      {pending && finished(r) && (
        <div className="route-end">
          <button className="btn primary" onClick={() => router.push("/")}>
            今日はここまで
          </button>
        </div>
      )}
      {count !== null && up && (
        <button className="route-next" onClick={go}>
          <span className="kicker">次は</span>
          <span className="display">{up.ja}</span>
          <span className="route-ring">{waiting ? <span className="spin" /> : count}</span>
          <span className="route-meta">{waiting && up.href.startsWith(NEW_EP) ? "新しい回を作っています" : up.meta}</span>
        </button>
      )}
    </>
  );
}
