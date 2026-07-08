"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { BoardDirectionLog, TeamMember } from "./types";

/**
 * 방향 로그 패널 — 프로젝트 의사결정 기록 (스펙: 수정은 UPDATE가 아니라
 * 새 row + supersedes, 확정은 director 전용 RPC). Realtime 동기화.
 */

const DL_STATUS: Record<string, { label: string; cls: string }> = {
  open: { label: "미확정", cls: "border-gold-bright/50 text-gold-bright" },
  confirmed: { label: "확정", cls: "border-verdict-good/50 text-verdict-good" },
  superseded: { label: "대체됨", cls: "border-board-line text-board-mut" },
};

function fmtDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${y.slice(2)}.${m}.${d}`;
}

export function DirectionPanel({
  projectId,
  boardId,
  initial,
  meId,
  isDirector,
  canEdit,
  team,
}: {
  projectId: string;
  boardId: string;
  initial: BoardDirectionLog[];
  meId: string;
  isDirector: boolean;
  canEdit: boolean;
  team: TeamMember[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [logs, setLogs] = useState<BoardDirectionLog[]>(initial);
  const [draft, setDraft] = useState<{ body: string; supersedes: string | null } | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const nameOf = useCallback(
    (id: string | null) => team.find((t) => t.id === id)?.name ?? "?",
    [team],
  );

  const refetch = useCallback(async () => {
    const { data } = await supabase
      .from("direction_logs")
      .select("id, author_id, body, status, supersedes, created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    setLogs(data ?? []);
  }, [supabase, projectId]);

  useEffect(() => {
    const ch = supabase
      .channel(`dirlog-${projectId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "direction_logs", filter: `project_id=eq.${projectId}` },
        refetch,
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [supabase, projectId, refetch]);

  function logEvent(type: string, payload: Record<string, string | number | null>) {
    supabase
      .from("events")
      .insert({ actor_id: meId, board_id: boardId, project_id: projectId, type, payload })
      .then(({ error }) => error && console.warn("이벤트 기록 실패:", error.message));
  }

  async function saveDraft() {
    if (!draft || draft.body.trim() === "") return;
    const { data: inserted, error } = await supabase
      .from("direction_logs")
      .insert({
        project_id: projectId,
        author_id: meId,
        body: draft.body.trim(),
        status: "open",
        supersedes: draft.supersedes,
      })
      .select()
      .single();
    if (error) {
      alert("저장 실패: " + error.message);
      return;
    }
    logEvent(draft.supersedes ? "direction.superseded" : "direction.added", {
      log_id: inserted.id,
      supersedes: draft.supersedes,
    });
    setDraft(null);
    await refetch();
  }

  async function setStatus(log: BoardDirectionLog, status: "open" | "confirmed") {
    const { error } = await supabase.rpc("set_direction_status", {
      p_log_id: log.id,
      p_status: status,
    });
    if (error) {
      alert("상태 변경 실패: " + error.message);
      return;
    }
    await refetch();
  }

  const active = logs.filter((l) => l.status !== "superseded");
  const superseded = logs.filter((l) => l.status === "superseded");

  return (
    <div className="py-2">
      {canEdit && !draft && (
        <button
          onClick={() => setDraft({ body: "", supersedes: null })}
          className="mb-2 rounded-full border border-board-line px-3 py-1 text-[11.5px] text-board-mut hover:border-gold-bright hover:text-gold-bright"
        >
          ＋ 방향 추가
        </button>
      )}

      {draft && (
        <div className="mb-3 flex flex-col gap-2 rounded-xl border border-gold-bright/30 bg-[#1f1f24] p-3.5">
          {draft.supersedes && (
            <span className="font-mono text-[10.5px] text-board-mut">
              기존 방향의 새 버전 작성 — 저장 시 이전 버전은 &quot;대체됨&quot; 이력으로 남습니다
            </span>
          )}
          <textarea
            autoFocus
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            placeholder="확정하고 싶은 방향 — 예: 라벨 마감은 무광 + 로고 스팟 UV"
            className="min-h-16 resize-y rounded-md border border-board-line bg-[#232327] px-2.5 py-2 text-[12.5px] leading-relaxed text-board-ink outline-none focus:border-gold-bright"
          />
          <div className="flex gap-2">
            <button
              onClick={saveDraft}
              className="rounded-full border border-gold-bright bg-gold-bright px-4 py-1.5 text-[12px] font-bold text-board-bg"
            >
              등록
            </button>
            <button
              onClick={() => setDraft(null)}
              className="rounded-full border border-board-line px-4 py-1.5 text-[12px] text-board-mut hover:text-board-ink"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {active.length === 0 && !draft && (
        <p className="py-3 text-sm text-board-mut">기록된 방향이 없습니다.</p>
      )}

      {active.map((l) => {
        const s = DL_STATUS[l.status] ?? DL_STATUS.open;
        return (
          <div key={l.id} className="flex items-start gap-2.5 border-t border-board-line py-2.5 text-[12.8px]">
            <span className={`mt-0.5 shrink-0 rounded-full border px-2 py-px text-[10px] ${s.cls}`}>{s.label}</span>
            <span className="text-[#cfccc4]">{l.body}</span>
            <span className="ml-auto flex shrink-0 items-center gap-1.5">
              <span className="font-mono text-[10px] text-board-mut">
                {nameOf(l.author_id)} · {fmtDate(l.created_at)}
              </span>
              {isDirector && l.status === "open" && (
                <button
                  onClick={() => setStatus(l, "confirmed")}
                  className="rounded-full border border-verdict-good/50 px-2 py-0.5 text-[10px] text-verdict-good hover:bg-verdict-good hover:text-white"
                >
                  확정
                </button>
              )}
              {isDirector && l.status === "confirmed" && (
                <button
                  onClick={() => setStatus(l, "open")}
                  className="rounded-full border border-board-line px-2 py-0.5 text-[10px] text-board-mut hover:text-board-ink"
                >
                  재오픈
                </button>
              )}
              {canEdit && (
                <button
                  onClick={() => setDraft({ body: l.body, supersedes: l.id })}
                  className="rounded-full border border-board-line px-2 py-0.5 text-[10px] text-board-mut hover:border-gold-bright hover:text-gold-bright"
                  title="새 버전 작성 (이전 버전은 이력으로)"
                >
                  수정
                </button>
              )}
            </span>
          </div>
        );
      })}

      {superseded.length > 0 && (
        <div className="border-t border-board-line pt-2">
          <button
            onClick={() => setShowHistory(!showHistory)}
            className="font-mono text-[10.5px] text-board-mut hover:text-gold-bright"
          >
            {showHistory ? "▾" : "▸"} 대체된 이전 버전 {superseded.length}건
          </button>
          {showHistory &&
            superseded.map((l) => (
              <div key={l.id} className="flex items-start gap-2.5 py-1.5 pl-1 text-[12px]">
                <span className="mt-0.5 shrink-0 rounded-full border border-board-line px-2 py-px text-[9.5px] text-board-mut">
                  대체됨
                </span>
                <span className="text-board-mut line-through">{l.body}</span>
                <span className="ml-auto shrink-0 font-mono text-[9.5px] text-board-mut">
                  {nameOf(l.author_id)} · {fmtDate(l.created_at)}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
