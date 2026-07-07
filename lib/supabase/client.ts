import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/database.types";

/** 브라우저용 Supabase 클라이언트 (anon key + 사용자 세션) */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
