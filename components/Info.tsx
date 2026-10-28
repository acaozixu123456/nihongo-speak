"use client";

import { useEffect, useRef, useState } from "react";

// ⓘ: extra info only on a tap, instead of a grey line always on screen.
export default function Info({ children, label = "说明" }: { children: React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  return (
    <span className="info" ref={box}>
      <button
        type="button"
        className="info-i"
        aria-label={label}
        aria-expanded={open}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(!open);
        }}
      >
        i
      </button>
      {open && (
        <span className="info-tip" role="tooltip">
          {children}
        </span>
      )}
    </span>
  );
}
