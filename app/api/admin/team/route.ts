import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 팀 관리 API (director 전용, 사용자 확장 — 2026-07-08).
 * 가입은 director 초대 방식(스펙 6장): 계정+초기 비밀번호 발급, profiles 사전 생성.
 * - GET: 멤버 목록 (이메일·비활성화 상태 포함)
 * - POST {action}: create | update | reset_password | set_active
 * 비밀번호는 응답으로 1회만 반환하고 어디에도 기록하지 않는다 (events 포함).
 */

const FREELANCER_PALETTE = ["#1D9E75", "#7F77DD", "#D8643A", "#2E7FB8"];

/** 읽기 쉬운 초기 비밀번호: oddity-xxxx-xxxx (혼동 문자 제외) */
function generatePassword() {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const pick = (n: number) =>
    Array.from(randomBytes(n), (b) => alphabet[b % alphabet.length]).join("");
  return `oddity-${pick(4)}-${pick(4)}`;
}

async function requireDirectorSession() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 }) };
  const { data: me } = await supabase
    .from("profiles")
    .select("id, role, name")
    .eq("id", user.id)
    .single();
  if (me?.role !== "director")
    return { error: NextResponse.json({ error: "대표만 사용할 수 있습니다." }, { status: 403 }) };
  return { me };
}

export async function GET() {
  const { me, error } = await requireDirectorSession();
  if (error) return error;

  const admin = createAdminClient();
  const [profiles, users] = await Promise.all([
    admin.from("profiles").select("id, name, role, color, created_at").order("created_at"),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);
  const authById = new Map(users.data?.users.map((u) => [u.id, u]) ?? []);
  const members = (profiles.data ?? []).map((p) => {
    const u = authById.get(p.id);
    const bannedUntil = (u as { banned_until?: string } | undefined)?.banned_until;
    return {
      ...p,
      email: u?.email ?? "",
      active: !bannedUntil || new Date(bannedUntil) < new Date(),
      is_me: p.id === me.id,
    };
  });
  return NextResponse.json({ members });
}

export async function POST(req: Request) {
  const { me, error } = await requireDirectorSession();
  if (error) return error;

  const admin = createAdminClient();
  const body = (await req.json()) as {
    action: "create" | "update" | "reset_password" | "set_active";
    id?: string;
    name?: string;
    email?: string;
    role?: "director" | "freelancer";
    color?: string;
    active?: boolean;
  };

  const logEvent = (type: string, payload: Record<string, string | number | boolean | null>) =>
    admin.from("events").insert({ actor_id: me.id, type, payload });

  // ----- 계정 발급 -----
  if (body.action === "create") {
    const name = body.name?.trim();
    const email = body.email?.trim().toLowerCase();
    const role = body.role === "director" ? "director" : "freelancer";
    const color =
      body.color?.trim() ||
      (role === "director" ? "#B8965A" : FREELANCER_PALETTE[Math.floor(Math.random() * 4)]);
    if (!name || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
      return NextResponse.json({ error: "이름과 올바른 이메일이 필요합니다." }, { status: 400 });

    const password = generatePassword();
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createErr)
      return NextResponse.json(
        { error: "계정 생성 실패: " + createErr.message },
        { status: 400 },
      );

    const { error: profErr } = await admin
      .from("profiles")
      .insert({ id: created.user.id, name, role, color });
    if (profErr) {
      await admin.auth.admin.deleteUser(created.user.id);
      return NextResponse.json({ error: "프로필 생성 실패: " + profErr.message }, { status: 500 });
    }
    await logEvent("team.member_created", { member_id: created.user.id, name, role });
    return NextResponse.json({ id: created.user.id, password });
  }

  if (!body.id) return NextResponse.json({ error: "대상이 없습니다." }, { status: 400 });

  // ----- 프로필 수정 (이름·색상·역할) -----
  if (body.action === "update") {
    if (body.id === me.id && body.role === "freelancer")
      return NextResponse.json({ error: "본인의 대표 권한은 해제할 수 없습니다." }, { status: 400 });
    const patch: Partial<{ name: string; color: string; role: string }> = {};
    if (body.name?.trim()) patch.name = body.name.trim();
    if (body.color?.trim()) patch.color = body.color.trim();
    if (body.role) patch.role = body.role;
    const { error: e } = await admin.from("profiles").update(patch).eq("id", body.id);
    if (e) return NextResponse.json({ error: e.message }, { status: 500 });
    await logEvent("team.member_updated", { member_id: body.id, ...patch });
    return NextResponse.json({ ok: true });
  }

  // ----- 비밀번호 재발급 -----
  if (body.action === "reset_password") {
    const password = generatePassword();
    const { error: e } = await admin.auth.admin.updateUserById(body.id, { password });
    if (e) return NextResponse.json({ error: e.message }, { status: 500 });
    await logEvent("team.password_reset", { member_id: body.id });
    return NextResponse.json({ password });
  }

  // ----- 비활성화 / 활성화 -----
  if (body.action === "set_active") {
    if (body.id === me.id)
      return NextResponse.json({ error: "본인 계정은 비활성화할 수 없습니다." }, { status: 400 });
    const { error: e } = await admin.auth.admin.updateUserById(body.id, {
      ban_duration: body.active ? "none" : "876000h", // ≈100년
    });
    if (e) return NextResponse.json({ error: e.message }, { status: 500 });
    await logEvent(body.active ? "team.member_activated" : "team.member_deactivated", {
      member_id: body.id,
    });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "알 수 없는 동작입니다." }, { status: 400 });
}
