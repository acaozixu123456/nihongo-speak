"use client";

import { play, ttsUrl, unlock } from "@/lib/client/player";

// 森先生: the teacher behind every correction, a kind older teacher. Her lines are read in an older
// woman's voice (Gemini's Gacrux; Azure's Mayu if Gemini is down).
export const SENSEI_VOICE = "ja-JP-MoriNeural|ja-JP-MayuNeural";

export function SenseiFace({ size = 54 }: { size?: number }) {
  return (
    <svg className="sensei-face" width={size} height={size} viewBox="0 0 120 120" aria-hidden>
      <clipPath id="sensei-clip">
        <circle cx="60" cy="60" r="60" />
      </clipPath>
      <circle cx="60" cy="60" r="60" fill="#efe2cf" />
      <g clipPath="url(#sensei-clip)">
        <path d="M14 124 C16 96 34 86 60 86 C86 86 104 96 106 124 Z" fill="#8a6a4f" />
        <path d="M48 86 L60 104 L72 86 Z" fill="#f6efe4" />
        <path d="M60 104 L60 124" stroke="#6f533c" strokeWidth="2" />
        <circle cx="60" cy="110" r="1.8" fill="#e8d7bd" />
        <circle cx="60" cy="118" r="1.8" fill="#e8d7bd" />
        <path d="M52 76 L52 88 Q60 94 68 88 L68 76 Z" fill="#f0c9a8" />
        <circle cx="60" cy="20" r="11" fill="#cfcac3" />
        <path d="M52 18 Q60 13 68 18" stroke="#b5afa7" strokeWidth="1.6" fill="none" />
        <ellipse cx="60" cy="50" rx="29" ry="30" fill="#d9d4cd" />
        <ellipse cx="60" cy="56" rx="23" ry="25" fill="#f5d3b5" />
        <ellipse cx="36.5" cy="58" rx="4" ry="6" fill="#f0c9a8" />
        <ellipse cx="83.5" cy="58" rx="4" ry="6" fill="#f0c9a8" />
        <circle cx="36" cy="64" r="1.4" fill="#e9e4dc" />
        <circle cx="84" cy="64" r="1.4" fill="#e9e4dc" />
        <path d="M36 52 C36 32 50 26 60 27 C72 26 85 33 84 52 C80 42 72 36 62 38 C54 36 44 40 36 52 Z" fill="#e3ded7" />
        <path d="M44 40 Q54 34 62 38" stroke="#c9c3bb" strokeWidth="1.4" fill="none" />
        <path d="M66 37 Q76 37 81 45" stroke="#c9c3bb" strokeWidth="1.4" fill="none" />
        <path d="M44 47 Q49 44.5 54 46.5" stroke="#b2aaa0" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <path d="M66 46.5 Q71 44.5 76 47" stroke="#b2aaa0" strokeWidth="1.8" fill="none" strokeLinecap="round" />
        <circle cx="49.5" cy="56" r="8" fill="#fff" fillOpacity=".25" stroke="#7a5a3e" strokeWidth="1.8" />
        <circle cx="70.5" cy="56" r="8" fill="#fff" fillOpacity=".25" stroke="#7a5a3e" strokeWidth="1.8" />
        <path d="M57.5 55 Q60 53.5 62.5 55" stroke="#7a5a3e" strokeWidth="1.8" fill="none" />
        <path d="M45.5 57 Q49.5 53 53.5 57" stroke="#4a3a2e" strokeWidth="2" fill="none" strokeLinecap="round" />
        <path d="M66.5 57 Q70.5 53 74.5 57" stroke="#4a3a2e" strokeWidth="2" fill="none" strokeLinecap="round" />
        <ellipse cx="46" cy="67" rx="5" ry="3.2" fill="#ec9f8e" opacity=".55" />
        <ellipse cx="74" cy="67" rx="5" ry="3.2" fill="#ec9f8e" opacity=".55" />
        <path d="M60 60 Q61.5 64 59.5 65" stroke="#d9a98a" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        <path d="M53 70 Q60 76.5 67 70" stroke="#a5523f" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      </g>
    </svg>
  );
}

// What she says, in her words: the Japanese big with ▶ to hear her, the Chinese small and grey.
export function SenseiSays({ ja, zh }: { ja: string; zh?: string }) {
  return (
    <div className="sensei-say">
      <div className="sensei-ja">
        <span>{ja}</span>
        <button
          className="bag-play"
          aria-label="聞く"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            unlock();
            play(ttsUrl(ja, SENSEI_VOICE), 1).catch(() => {});
          }}
        >
          ▶
        </button>
      </div>
      {zh && <div className="sensei-zh">{zh}</div>}
    </div>
  );
}
