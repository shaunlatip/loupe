import { promises as fs } from "fs";
import path from "path";

export interface Settings {
  exportDir: string;
}

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "settings.json");

export const DEFAULT_SETTINGS: Settings = {
  exportDir: "/Users/shaunlatip/Downloads/loupe-exports",
};

export async function getSettings(): Promise<Settings> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<Settings>;
    if (typeof parsed.exportDir === "string" && parsed.exportDir) {
      return { exportDir: parsed.exportDir };
    }
  } catch {
    // missing or corrupt → defaults
  }
  return { ...DEFAULT_SETTINGS };
}

export async function saveSettings(settings: Settings): Promise<Settings> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tmp = path.join(DATA_DIR, `.settings-${Date.now()}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(settings, null, 2) + "\n", "utf8");
  await fs.rename(tmp, FILE);
  return settings;
}
