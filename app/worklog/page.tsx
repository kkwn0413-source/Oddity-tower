import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { WorklogView } from "@/components/worklog/worklog-view";

/**
 * 개인 업무일지 (사용자 확장 — 2026-07-08).
 * RLS: 본인 전체 CRUD + 대표는 전원 열람(SELECT)만. 서로의 일지는 못 본다.
 * hours(실제 업무시간)가 금액 정산의 기준.
 */
export default async function WorklogPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const [logs, team, projects] = await Promise.all([
    supabase
      .from("work_logs")
      .select("id, author_id, work_date, project_id, content, hours, note")
      .order("work_date", { ascending: false })
      .order("created_at", { ascending: false }),
    supabase.rpc("team_directory"),
    supabase.from("projects").select("id, code, name").order("created_at"),
  ]);

  return (
    <div className="mx-auto max-w-[860px] px-4 py-6 sm:px-6">
      <WorklogView
        initialLogs={logs.data ?? []}
        team={(team.data ?? []).map((t) => ({
          id: t.id,
          name: t.name,
          role: t.role,
          color: t.color,
        }))}
        projects={projects.data ?? []}
        meId={profile.id}
        meName={profile.name}
        isDirector={profile.role === "director"}
      />
    </div>
  );
}
