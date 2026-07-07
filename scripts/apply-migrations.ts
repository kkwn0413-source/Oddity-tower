/**
 * supabase/migrations/*.sql 을 순서대로 적용한다. 실행: npm run db:apply
 *
 * 연결 우선순위:
 *  1. SUPABASE_DB_URL     — Postgres 직접 연결 (pg)
 *  2. SUPABASE_ACCESS_TOKEN — Management API (api.supabase.com) 경유
 *
 * 마이그레이션은 idempotent하게 작성돼 있어 재실행해도 안전하다.
 */
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvLocal, requireEnv } from "./db";

const env = loadEnvLocal();

function migrationFiles(): Array<{ name: string; sql: string }> {
  const dir = resolve(process.cwd(), "supabase/migrations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(resolve(dir, name), "utf8") }));
}

async function applyViaPg(dbUrl: string) {
  const { Client } = await import("pg");
  const client = new Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log("✅ DB 직접 연결됨 (pg)");
  try {
    for (const { name, sql } of migrationFiles()) {
      process.stdout.write(`→ ${name} 적용 중... `);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("commit");
        console.log("완료");
      } catch (e) {
        await client.query("rollback");
        console.log("실패");
        throw e;
      }
    }
  } finally {
    await client.end();
  }
}

async function applyViaManagementApi(token: string) {
  const url = requireEnv(env, "NEXT_PUBLIC_SUPABASE_URL");
  const ref = new URL(url).hostname.split(".")[0];
  console.log(`✅ Management API 사용 (project ref: ${ref})`);

  const run = async (sql: string) => {
    const res = await fetch(
      `https://api.supabase.com/v1/projects/${ref}/database/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: sql }),
      },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status} — ${await res.text()}`);
    return res.json();
  };

  // 적용 이력 테이블 — 새 파일만 적용 (스키마 진화 시 과거 파일 재실행 방지)
  await run(
    `create table if not exists public._migrations (
       name text primary key, applied_at timestamptz not null default now()
     ); alter table public._migrations enable row level security;`,
  );
  const applied = new Set(
    ((await run(`select name from public._migrations`)) as { name: string }[]).map(
      (r) => r.name,
    ),
  );

  for (const { name, sql } of migrationFiles()) {
    if (applied.has(name)) {
      console.log(`→ ${name} 건너뜀 (적용됨)`);
      continue;
    }
    process.stdout.write(`→ ${name} 적용 중... `);
    try {
      await run(sql);
      await run(
        `insert into public._migrations (name) values ('${name.replace(/'/g, "''")}') on conflict do nothing`,
      );
      console.log("완료");
    } catch (e) {
      console.log("실패");
      throw new Error(`${name}: ${(e as Error).message}`);
    }
  }
}

async function main() {
  if (env.SUPABASE_DB_URL) {
    await applyViaPg(env.SUPABASE_DB_URL);
  } else if (env.SUPABASE_ACCESS_TOKEN) {
    await applyViaManagementApi(env.SUPABASE_ACCESS_TOKEN);
  } else {
    console.error(
      "❌ .env.local에 SUPABASE_DB_URL 또는 SUPABASE_ACCESS_TOKEN이 필요합니다.\n" +
        "   (또는 supabase/migrations/*.sql 을 SQL Editor에 순서대로 붙여넣기)",
    );
    process.exit(1);
  }
  console.log("✅ 마이그레이션 전체 적용 완료");
}

main().catch((e) => {
  console.error("❌ 마이그레이션 실패:", e.message ?? e);
  process.exit(1);
});
