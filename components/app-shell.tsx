import Link from "next/link";
import { MainNav } from "@/components/main-nav";

/**
 * 앱 셸 — 상단 네이비 헤더 + 콘텐츠 영역.
 * 인증/역할 가드는 3단계에서 붙는다. 지금은 정적 스켈레톤.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-navy text-white">
        <div className="flex h-14 items-center gap-6 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 shrink-0">
            <span
              className="inline-block h-3 w-3 rotate-45 bg-gold"
              aria-hidden
            />
            <span className="text-[15px] font-semibold tracking-tight">
              오디티하우스{" "}
              <span className="text-white/50 font-normal">컨트롤타워</span>
            </span>
          </Link>
          <MainNav />
          <div className="ml-auto flex items-center gap-3">
            {/* 3단계에서 세션/역할 배지·로그아웃으로 교체 */}
            <span className="text-xs text-white/40">MVP</span>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
}
