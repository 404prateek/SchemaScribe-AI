import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateExecutiveReport } from "@/lib/describer";
import { getSession } from "@/lib/kvStore";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { session_id, dataset_context = "" } = await req.json();
  if (!session_id) return NextResponse.json({ error: "Missing session_id" }, { status: 400 });

  const sessionData = await getSession(session_id);
  if (!sessionData) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const report = await generateExecutiveReport(sessionData.data, dataset_context);
  return NextResponse.json({ status: "success", report });
}
