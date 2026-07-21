import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { getSettings, saveSettings } from "@/lib/settings";

export async function GET() {
  const settings = await getSettings();
  return NextResponse.json(settings);
}

export async function PUT(req: NextRequest) {
  const body = (await req.json()) as { exportDir?: string };
  const exportDir = body.exportDir?.trim();
  if (!exportDir || !path.isAbsolute(exportDir)) {
    return NextResponse.json(
      { error: "exportDir must be an absolute path" },
      { status: 400 }
    );
  }
  const settings = await saveSettings({ exportDir });
  return NextResponse.json(settings);
}
