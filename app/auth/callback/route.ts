import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * 매직링크 랜딩 — PKCE code 또는 token_hash 둘 다 처리.
 * 성공 시 next(기본 /)로, 실패 시 /login?error=1 로.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const next = searchParams.get("next") ?? "/";

  const supabase = await createClient();

  let ok = false;
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  } else if (tokenHash) {
    const { error } = await supabase.auth.verifyOtp({
      type: "email",
      token_hash: tokenHash,
    });
    ok = !error;
  }

  if (ok) {
    let dest = next.startsWith("/") ? next : "/";
    // freelancer의 기본 진입점은 /me (스펙 6.1)
    if (dest === "/") {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .single();
        if (profile?.role === "freelancer") dest = "/me";
      }
    }
    return NextResponse.redirect(`${origin}${dest}`);
  }
  return NextResponse.redirect(`${origin}/login?error=link`);
}
