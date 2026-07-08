import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { Timeline } from "@/components/timeline/timeline";
import type { TimelineData } from "@/components/timeline/types";

/**
 * 메인 타임라인 — RLS 덕에 freelancer는 자기 태스크 범위만 내려온다.
 * 별도 분기 UI 최소화 (스펙 6.1).
 */
export default async function HomePage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const [clients, projects, milestones, tasks, profiles] = await Promise.all([
    supabase.from("clients").select("id, name").order("name"),
    supabase
      .from("projects")
      .select("id, client_id, name, code, status, prod_anchor_date")
      .order("created_at"),
    supabase.from("milestones").select("id, project_id, label, due_date"),
    supabase
      .from("tasks")
      .select(
        "id, project_id, name, description, assignee_id, start_date, end_date, status, sort_order",
      ),
    supabase.from("profiles").select("id, name, role, color"),
  ]);

  const data: TimelineData = {
    clients: clients.data ?? [],
    projects: projects.data ?? [],
    milestones: milestones.data ?? [],
    tasks: tasks.data ?? [],
    profiles: profiles.data ?? [],
  };

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">
      <Timeline
        data={data}
        meId={profile.id}
        isDirector={profile.role === "director"}
      />
    </div>
  );
}
