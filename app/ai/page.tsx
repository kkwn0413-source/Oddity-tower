import { requireDirector } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AiReview } from "@/components/ai/ai-review";

/**
 * AI 일정 반영 (대표 전용, 사용자 확장 — 2026-07-08).
 * 자료 입력 → Claude 해석 → 당사자 확인 취합 → 대표 최종 컨펌 → 실제 반영.
 */
export default async function AiPage() {
  const profile = await requireDirector();
  const supabase = await createClient();

  const [sets, items, team, projects] = await Promise.all([
    supabase
      .from("ai_change_sets")
      .select("id, summary, notes, status, source_text, created_at, applied_at")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("ai_change_items")
      .select(
        "id, set_id, seq, action, task_id, project_id, assignee_id, summary, payload, before, ack_status, ack_comment, applied",
      )
      .order("seq"),
    supabase.rpc("team_directory"),
    supabase.from("projects").select("id, code, name"),
  ]);

  return (
    <div className="mx-auto max-w-[860px] px-4 py-6 sm:px-6">
      <AiReview
        sets={(sets.data ?? []) as never}
        items={(items.data ?? []) as never}
        team={(team.data ?? []).map((t) => ({
          id: t.id,
          name: t.name,
          role: t.role,
          color: t.color,
        }))}
        projects={projects.data ?? []}
        meId={profile.id}
      />
    </div>
  );
}
