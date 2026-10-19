import { NextResponse } from "next/server";
import { readState, storageReady, syncProgress } from "@/lib/store";
import { readTeacher } from "@/lib/teacher";

const off = () => NextResponse.json({ error: "storage not set up" }, { status: 503 });

export async function GET() {
  if (!storageReady()) return off();
  const [state, teacher] = await Promise.all([readState(), readTeacher().catch(() => null)]);
  return NextResponse.json({ progress: state.progress, teacher });
}

export async function PUT(request: Request) {
  if (!storageReady()) return off();
  try {
    const [progress, teacher] = await Promise.all([syncProgress(await request.json()), readTeacher().catch(() => null)]);
    return NextResponse.json({ progress, teacher });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "sync failed" }, { status: 502 });
  }
}
