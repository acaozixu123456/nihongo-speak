import Link from "next/link";
import type { TopicRow } from "@/lib/client/retell-history";

// One story in the 三回話す lists: its Japanese name big, how many times it was told and its latest score.
// bare: no もう一回 tag (in a list already headed もう一回).
export function RetellRow({ r, bare, sub }: { r: TopicRow; bare?: boolean; sub?: string }) {
  return (
    <Link href={r.href} className={`rt-row${r.mark ? ` ${r.mark}` : ""}`}>
      <span className="rt-t">
        <b>
          {r.ja}
          {!bare && r.mark === "again" && <em className="rt-tag">もう一回</em>}
          {r.mark === "grad" && <em className="rt-tag grad">卒業</em>}
        </b>
        {sub && <span>{sub}</span>}
      </span>
      {r.times > 0 ? <span className="rt-n">{r.times}回</span> : null}
      {r.score !== null ? (
        <span className={`rt-s${r.up !== null && r.up > 0 ? " up" : ""}`}>
          {r.score}
          {r.up !== null && r.up > 0 && <small>↑{r.up}</small>}
        </span>
      ) : r.times ? null : (
        <span className="rt-mada">まだ</span>
      )}
      <i className="rt-chev">›</i>
    </Link>
  );
}
