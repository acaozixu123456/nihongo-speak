import { readFile } from "@/lib/earworm";

const ID = /^[a-z0-9-]{1,40}$/i;
const FILE = /^(song\.mp3|[ci]\d{1,2}\.(mp4|png))$/;
const TYPE = { mp3: "audio/mpeg", mp4: "video/mp4", png: "image/png" } as const;

// The song, pictures and animations of a 洗脑歌, out of the private Blob store. They never change.
export async function GET(_: Request, { params }: { params: Promise<{ id: string; file: string }> }) {
  const { id, file } = await params;
  if (!ID.test(id) || !FILE.test(file)) return new Response("not found", { status: 404 });
  const body = await readFile(id, file);
  if (!body) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": TYPE[file.split(".").pop() as keyof typeof TYPE],
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
