export default function HomePage() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <div className="rounded-xl border border-black/5 bg-card p-8 shadow-sm">
        <div className="flex items-center gap-2 text-gold">
          <span className="inline-block h-2.5 w-2.5 rotate-45 bg-gold" />
          <span className="text-xs font-medium uppercase tracking-widest">
            Control Tower · MVP
          </span>
        </div>
        <h1 className="mt-3 text-2xl font-semibold text-navy">
          오디티하우스 컨트롤타워
        </h1>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-navy/60">
          프로젝트 · 일정 · 파일을 한곳에서 관리하는 내부 툴. 위계형 타임라인
          캘린더(클라이언트 → 프로젝트 → 태스크)를 중심으로, 프로젝트별 레퍼런스
          보드와 선발주 트래커를 제공합니다.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {[
            { t: "타임라인", d: "위계형 캘린더 · 프로젝트별/인원별 뷰" },
            { t: "레퍼런스 보드", d: "이미지 큐레이션 + 디렉팅 판정" },
            { t: "선발주 트래커", d: "제작 목표일 역산 (대표 전용)" },
          ].map((c) => (
            <div
              key={c.t}
              className="rounded-lg border border-black/5 bg-bg/60 p-4"
            >
              <div className="text-sm font-semibold text-navy">{c.t}</div>
              <div className="mt-1 text-xs text-navy/50">{c.d}</div>
            </div>
          ))}
        </div>

        <p className="mt-6 text-xs text-navy/40">
          1단계 스캐폴딩 완료 — 다음 단계에서 Supabase 스키마 · 인증 · 실데이터
          연동이 붙습니다.
        </p>
      </div>
    </div>
  );
}
