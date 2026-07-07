import { requireProfile } from "@/lib/auth";

/** 내 작업 대시보드 — 8단계에서 본격 구현. 지금은 인증/역할 확인용 스텁. */
export default async function MePage() {
  const profile = await requireProfile();

  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="rounded-xl border border-black/5 bg-card p-8 shadow-sm">
        <div className="flex items-center gap-2">
          <span
            className="inline-block h-3 w-3 rounded-full"
            style={{ backgroundColor: profile.color }}
            aria-hidden
          />
          <h1 className="text-xl font-semibold text-navy">
            {profile.name}님의 작업 공간
          </h1>
          {profile.role === "director" && (
            <span className="rounded bg-gold/15 px-1.5 py-0.5 text-[11px] font-medium text-gold">
              대표
            </span>
          )}
        </div>
        <p className="mt-2 text-sm text-navy/50">
          내 태스크 · 디렉팅 피드백 피드 · 개인 메모가 8단계에서 여기에
          구성됩니다.
        </p>
      </div>
    </div>
  );
}
