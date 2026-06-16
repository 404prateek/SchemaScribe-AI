import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateColumnInsights } from "@/lib/describer";
import { getSession, storeSession } from "@/lib/kvStore";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { session_id, column_index, dataset_context = "" } = await req.json();

  if (!session_id || column_index === undefined) {
    return NextResponse.json({ error: "Missing session_id or column_index" }, { status: 400 });
  }

  const sessionData = await getSession(session_id);
  if (!sessionData) {
    return NextResponse.json({ error: "Session not found or expired" }, { status: 404 });
  }

  const col = sessionData.data.columns[column_index];
  if (!col) {
    return NextResponse.json({ error: "Column index out of range" }, { status: 400 });
  }

  const { description, recommendation } = await generateColumnInsights(
    col.name,
    col,
    dataset_context
  );

  // Patch and persist
  sessionData.data.columns[column_index].description = description;
  sessionData.data.columns[column_index].recommendation = recommendation;
  await storeSession(session_id, sessionData);

  return NextResponse.json({
    column_index,
    column_name: col.name,
    description,
    recommendation,
  });
}
