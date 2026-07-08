import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CreateMyBoard } from "@/components/board/create-my-board";

type BoardRow = {
  id: string;
  kind: string;
  project_id: string | null;
  owner_id: string | null;
  title: string;
  shared: boolean;
  access: string;
};

/** 보드 허브 — 프로젝트 보드 / 공유 보드 / 내 보드 / 공유된 개인 보드 */
export default async function BoardsPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const [{ data: boards }, { data: zones }, { data: projects }] =
    await Promise.all([
      supabase.from("boards").select("*").order("created_at"),
      supabase.from("ref_zones").select("id, board_id"),
      supabase.from("projects").select("id, code"),
    ]);

  const zoneCount = new Map<string, number>();
  for (const z of zones ?? []) {
    zoneCount.set(z.board_id, (zoneCount.get(z.board_id) ?? 0) + 1);
  }
  const codeByProject = new Map((projects ?? []).map((p) => [p.id, p.code]));

  const all: BoardRow[] = boards ?? [];
  const projectBoards = all.filter((b) => b.kind === "project");
  const sharedBoards = all.filter((b) => b.kind === "shared");
  const myBoards = all.filter(
    (b) => b.kind === "personal" && b.owner_id === profile.id,
  );
  const teamBoards = all.filter(
    (b) => b.kind === "personal" && b.owner_id !== profile.id,
  );

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-8 sm:px-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold text-navy">레퍼런스 보드</h1>
        <span className="text-xs text-navy/40">
          프로젝트별 · 개인 수집 · 전체 공용
        </span>
      </div>
      <BoardSection
        title="프로젝트 보드"
        items={projectBoards}
        zoneCount={zoneCount}
        codeByProject={codeByProject}
      />
      <BoardSection
        title="공용 보드"
        hint="전 인원 공동 편집"
        items={sharedBoards}
        zoneCount={zoneCount}
        codeByProject={codeByProject}
      />
      {myBoards.length > 0 ? (
        <BoardSection
          title="내 수집함"
          hint="개인 공간 — 공개 토글 시 전체 열람 가능"
          items={myBoards}
          zoneCount={zoneCount}
          codeByProject={codeByProject}
        />
      ) : (
        <section>
          <h2 className="text-sm font-bold uppercase tracking-widest text-navy/40">
            내 수집함
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <CreateMyBoard meId={profile.id} meName={profile.name} />
          </div>
        </section>
      )}
      <BoardSection
        title="팀원 수집함"
        hint="공개 설정된 개인 보드"
        items={teamBoards}
        zoneCount={zoneCount}
        codeByProject={codeByProject}
      />
    </div>
  );
}

function BoardSection({
  title,
  hint,
  items,
  zoneCount,
  codeByProject,
}: {
  title: string;
  hint?: string;
  items: BoardRow[];
  zoneCount: Map<string, number>;
  codeByProject: Map<string, string>;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <div className="flex items-baseline gap-2">
        <h2 className="text-sm font-bold uppercase tracking-widest text-navy/40">
          {title}
        </h2>
        {hint && <span className="text-xs text-navy/30">{hint}</span>}
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((b) => (
          <Link
            key={b.id}
            href={`/boards/${b.id}`}
            className="group rounded-xl border border-black/5 bg-card p-5 shadow-sm transition-shadow hover:shadow-md"
          >
            <div className="flex items-center gap-2">
              {b.kind === "project" && b.project_id && (
                <span className="rounded bg-navy/8 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-navy/55">
                  {codeByProject.get(b.project_id)}
                </span>
              )}
              {b.kind === "shared" && (
                <span className="rounded bg-gold/15 px-1.5 py-0.5 text-[10px] font-bold text-gold">
                  공용
                </span>
              )}
              {b.kind === "personal" && b.shared && (
                <span className="rounded bg-gold/15 px-1.5 py-0.5 text-[10px] font-bold text-gold">
                  공개
                </span>
              )}
              {b.access === "restricted" && (
                <span className="rounded bg-navy/8 px-1.5 py-0.5 text-[10px] font-bold text-navy/60">
                  🔒 지정 인원
                </span>
              )}
              <span className="truncate text-[15px] font-semibold text-navy group-hover:text-gold">
                {b.title}
              </span>
            </div>
            <div className="mt-2 text-xs text-navy/40">
              구역 {zoneCount.get(b.id) ?? 0}개
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
