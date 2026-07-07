import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/database.types";

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];

/** 현재 로그인 사용자의 프로필. 미로그인이면 null. */
export async function getProfile(): Promise<Profile | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  return data;
}

/** 로그인 필수 페이지용 — 미로그인 시 /login으로 */
export async function requireProfile(): Promise<Profile> {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  return profile;
}

/** director 전용 페이지용 — freelancer는 /me로 돌려보낸다 */
export async function requireDirector(): Promise<Profile> {
  const profile = await requireProfile();
  if (profile.role !== "director") redirect("/me");
  return profile;
}
