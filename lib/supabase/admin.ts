import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

/**
 * 서버 전용 service role 클라이언트 — RLS 우회.
 * 계정 발급(/api/admin/team), 공유 링크(/api/share) 등 관리 경로에서만 사용.
 * 절대 클라이언트 번들로 새어나가면 안 된다.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
