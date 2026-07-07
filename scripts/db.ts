import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/** .env.local 파서 — dotenv 의존 없이 최소 구현 */
export function loadEnvLocal(): Record<string, string> {
  const path = resolve(process.cwd(), ".env.local");
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trim().startsWith("#")) out[m[1]] = m[2];
  }
  return out;
}

export function requireEnv(env: Record<string, string>, key: string): string {
  const v = env[key];
  if (!v) {
    console.error(`❌ .env.local에 ${key}가 없습니다.`);
    process.exit(1);
  }
  return v;
}
