import Link from "next/link";
import { MainNav } from "@/components/main-nav";
import type { Profile } from "@/lib/auth";

/** 앱 셸 — 상단 네이비 헤더 + 콘텐츠 영역. profile=null이면 비로그인(로그인/공유 페이지). */
export function AppShell({
  profile,
  children,
}: {
  profile: Profile | null;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-navy text-white">
        <div className="flex h-14 items-center gap-6 px-4 sm:px-6">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <span
              className="inline-block h-3 w-3 rotate-45 bg-gold"
              aria-hidden
            />
            <span className="text-[15px] font-semibold tracking-tight">
              오디티하우스{" "}
              <span className="font-normal text-white/50">컨트롤타워</span>
            </span>
          </Link>

          {profile && <MainNav role={profile.role} />}

          <div className="ml-auto flex items-center gap-3">
            {profile && (
              <>
                <span className="flex items-center gap-1.5 text-sm">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: profile.color }}
                    aria-hidden
                  />
                  <span className="text-white/80">{profile.name}</span>
                  {profile.role === "director" && (
                    <span className="rounded bg-gold/20 px-1.5 py-0.5 text-[11px] font-medium text-gold">
                      대표
                    </span>
                  )}
                </span>
                <form action="/auth/signout" method="post">
                  <button
                    type="submit"
                    className="rounded-md px-2 py-1 text-xs text-white/50 transition-colors hover:bg-white/5 hover:text-white"
                  >
                    로그아웃
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
}
