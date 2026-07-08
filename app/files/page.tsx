import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ReportFiles } from "@/components/files/report-files";

/**
 * 보고 파일 (내부용, 사용자 확장 — 2026-07-08).
 * 업체 보고용으로 승인(approved)된 파일만 업체 → 프로젝트로 모아 바로 훑어본다.
 * RLS 범위 그대로 — 대표는 전체, 프리랜서는 자기 태스크·담당 프로젝트 범위만.
 */
export default async function ReportFilesPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const [files, tasks, projects, clients, team] = await Promise.all([
    supabase
      .from("task_files")
      .select("id, task_id, uploader_id, kind, name, url, version, created_at")
      .eq("approved", true)
      .order("created_at", { ascending: false }),
    supabase.from("tasks").select("id, name, project_id"),
    supabase.from("projects").select("id, code, name, client_id"),
    supabase.from("clients").select("id, name"),
    supabase.rpc("team_directory"),
  ]);

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-6 sm:px-6">
      <ReportFiles
        files={(files.data ?? []) as never}
        tasks={tasks.data ?? []}
        projects={projects.data ?? []}
        clients={clients.data ?? []}
        team={(team.data ?? []).map((t) => ({ id: t.id, name: t.name, color: t.color }))}
        isDirector={profile.role === "director"}
        meId={profile.id}
      />
    </div>
  );
}
