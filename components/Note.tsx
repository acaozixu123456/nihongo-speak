// A short line on a result: the Japanese first, the Chinese small and grey under it. While something is
// being worked out (wait), a spinner sits in front.
export default function Note({ ja, zh, wait = false }: { ja: string; zh?: string; wait?: boolean }) {
  return (
    <div className={`fb-line${wait ? " wait" : ""}`}>
      <div className="fb-line-ja">
        {wait && <span className="spin" />}
        {ja}
      </div>
      {zh && <div className="fb-line-zh">{zh}</div>}
    </div>
  );
}
