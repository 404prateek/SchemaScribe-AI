import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sarvamApiKey = process.env.SARVAM_API_KEY;
  if (!sarvamApiKey) {
    console.error("[VOICE] SARVAM_API_KEY is not defined in environment variables");
    return NextResponse.json(
      { error: "Voice transcription service is not configured (missing API key)." },
      { status: 500 }
    );
  }

  try {
    const formData = await req.formData();
    const audioFile = formData.get("audio");

    if (!audioFile || !(audioFile instanceof Blob)) {
      return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
    }

    // Convert Next.js Web Blob to Buffer/Blob format for forwarding
    const sarvamFormData = new FormData();
    sarvamFormData.append("file", audioFile, "recording.wav");
    sarvamFormData.append("model", "saaras:v3");
    sarvamFormData.append("language_code", "unknown");
    sarvamFormData.append("mode", "transcribe");

    console.log("[VOICE] Forwarding audio to Sarvam AI...");
    const res = await fetch("https://api.sarvam.ai/speech-to-text", {
      method: "POST",
      headers: {
        "api-subscription-key": sarvamApiKey,
      },
      body: sarvamFormData,
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[VOICE] Sarvam API returned error status ${res.status}:`, errorText);
      return NextResponse.json(
        { error: `Sarvam AI speech-to-text failed with status ${res.status}` },
        { status: 500 }
      );
    }

    const data = await res.json();
    const transcript = data.transcript || data.text || "";
    console.log("[VOICE] Transcription completed successfully: ", transcript);

    return NextResponse.json({ transcript });
  } catch (error: any) {
    console.error("[VOICE] Transcription error occurred:", error);
    return NextResponse.json(
      { error: error.message || "Voice transcription failed" },
      { status: 500 }
    );
  }
}
