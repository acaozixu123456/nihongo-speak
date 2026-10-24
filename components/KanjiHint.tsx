import { mnemonicsIn } from "@/lib/kanji-mnemonic";

// 形→義 drawings for the few kanji that are pictures (lib/kanji-mnemonic.ts), marked as a memory aid.
export default function KanjiHint({ word }: { word: string }) {
  const ms = mnemonicsIn(word);
  if (!ms.length) return null;
  return (
    <div className="kh">
      {ms.map((m) => (
        <div key={m.k} className="kh-one">
          <svg viewBox="0 0 40 40" width="34" height="34" aria-hidden>
            <path d={m.d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>→</span>
          <b>{m.k}</b>
          <small>{m.zh}</small>
        </div>
      ))}
      <div className="kh-note">助记，非词源</div>
    </div>
  );
}
