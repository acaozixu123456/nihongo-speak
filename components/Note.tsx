// A short line on a result, in Chinese. While something is being worked out (wait), a spinner sits in front.
export default function Note({ text, wait = false }: { text: string; wait?: boolean }) {
  return (
    <div className={`fb-line${wait ? " wait" : ""}`}>
      <div className="fb-line-ja">
        {wait && <span className="spin" />}
        {text}
      </div>
    </div>
  );
}
