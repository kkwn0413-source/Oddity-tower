import { requireDirector } from "@/lib/auth";
import { TeamAdmin } from "@/components/admin/team-admin";

/** 팀 관리 (director 전용) — 계정 발급·수정·비밀번호 재발급·비활성화. */
export default async function TeamAdminPage() {
  await requireDirector();
  return (
    <div className="mx-auto max-w-[720px] px-4 py-6 sm:px-6">
      <TeamAdmin />
    </div>
  );
}
