import { requireProfile } from "@/lib/auth";
import { AccountForm } from "@/components/admin/account-form";

/** 내 계정 — 본인 비밀번호 변경 (전 역할 공통). */
export default async function AccountPage() {
  const profile = await requireProfile();
  return (
    <div className="mx-auto max-w-[480px] px-4 py-6 sm:px-6">
      <AccountForm name={profile.name} />
    </div>
  );
}
