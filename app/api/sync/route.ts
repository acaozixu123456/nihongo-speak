import { NextResponse } from "next/server";
import { readState, storageReady, syncProgress } from "@/lib/store";

const off = () => NextResponse.json({ error: "storage not set up" }, { status: 503 });

export async function GET() {
  if (!storageReady()) return off();
  return NextResponse.json({ progress: (await readState()).progress });
}

export async function PUT(request: Request) {
  if (!storageReady()) return off();
  try {
    return NextResponse.json({ progress: await syncProgress(await request.json()) });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "sync failed" }, { status: 502 });
  }
}
