"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ACTION_LABEL, fieldLines, type AiItem } from "./types";

/**
 * AI 변경안 당사자 확인 팝업 — 모든 페이지에서 뜬다 (app-shell 마운트).
 * 내게 온 pending 항목이 있으면 모달로 "이 내용이 맞는지" 묻고,
 * 확인(agreed) / 이견(disputed+사유)을 기록한다. 응답은 대표 화면으로 취합된다.
 * "나중에"로 닫으면 다음 페이지 이동 시 다시 뜬다 (인지시키는 게 목적).
 */
export function AckPopup({ meId }: { meId: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [pending, setPending] = useState<(AiItem & { set_summary: string })[]>([]);
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("ai_change_items")
      .select(
        "id, set_id, seq, action, task_id, project_id, assignee_id, summary, payload, before, ack_status, ack_comment, applied, ai_change_sets!inner(status, summary)",
      )
      .eq("assignee_id", meId)
      .eq("ack_status", "pending")
      .eq("ai_change_sets.status", "proposed")
      .order("created_at");
    setPending(
      (data ?? []).map((r) => ({
        ...(r as unknown as AiItem),
        set_summary: (r as { ai_change_sets: { summary: string } }).ai_change_sets.summary,
      })),
    );
  }, [supabase, meId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function respond(item: AiItem, status: "agreed" | "disputed") {
    let comment: string | null = null;
    if (status === "disputed") {
      comment = window.prompt("어떤 부분이 다른가요? (대표에게 전달됩니다 — 필수)");
      if (comment === null) return;
      if (!comment.trim()) return alert("이견 사유를 입력해주세요.");
    }
    setBusy(item.id);
    const { error } = await supabase
      .from("ai_change_items")
      .update({
        ack_status: status,
        ack_comment: comment?.trim() ?? null,
        ack_at: new Date().toISOString(),
      })
      .eq("id", item.id);
    setBusy(null);
    if (error) return alert("응답 실패: " + error.message);
    supabase
      .from("events")
      .insert({ actor_id: meId, type: "ai.acked", payload: { item_id: item.id, status } })
      .then(({ error: e }) => e && console.warn("이벤트 기록 실패:", e.message));
    setPending((prev) => prev.filter((p) => p.id !== item.id));
  }

  if (hidden || pending.length === 0) return null;

  return (
    <>
      <div className="fixed inset-0 z-[60] bg-navy/40" />
      <div className="fixed left-1/2 top-1/2 z-[70] max-h-[80vh] w-[min(480px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl bg-card p-5 shadow-2xl">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rotate-45 bg-gold" aria-hidden />
          <span className="text-[15px] font-bold text-navy">일정 변경 확인 요청</span>
          <span className="rounded bg-gold/15 px-1.5 py-0.5 text-[10px] font-bold text-gold">
            {pending.length}건
          </span>
        </div>
        <p className="mt-1 text-xs leading-relaxed text-navy/50">
          대표가 넣은 자료를 AI가 해석한 변경안입니다. 내용이 맞는지 확인해주세요 — 응답이
          대표에게 전달되고, 대표가 최종 컨펌해야 실제로 반영됩니다.
        </p>

        <div className="mt-3 flex flex-col gap-2">
          {pending.map((it) => (
            <div key={it.id} className="rounded-lg border border-navy/10 bg-bg/60 px-3 py-2.5">
              <div className="flex items-center gap-1.5 text-[11px] text-navy/45">
                <span
                  className={
                    "rounded px-1 py-px text-[9px] font-bold " +
                    (it.action === "delete"
                      ? "bg-danger/10 text-danger"
                      : it.action === "create"
                        ? "bg-[#1D9E75]/15 text-[#1D9E75]"
                        : "bg-navy/10 text-navy/60")
                  }
                >
                  {ACTION_LABEL[it.action]}
                </span>
                <span className="truncate">{it.set_summary}</span>
              </div>
              <p className="mt-1 text-[13px] font-medium leading-relaxed text-navy">{it.summary}</p>
              {fieldLines(it).map((l, k) => (
                <p key={k} className="text-[11px] text-navy/55">{l}</p>
              ))}
              <div className="mt-2 flex gap-1.5">
                <button
                  onClick={() => respond(it, "agreed")}
                  disabled={busy === it.id}
                  className="rounded-md bg-navy px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  ✓ 내용이 맞습니다
                </button>
                <button
                  onClick={() => respond(it, "disputed")}
                  disabled={busy === it.id}
                  className="rounded-md border border-danger/30 px-3 py-1.5 text-xs text-danger hover:bg-danger/5 disabled:opacity-50"
                >
                  이견 있음
                </button>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={() => setHidden(true)}
          className="mt-3 w-full rounded-md py-1.5 text-xs text-navy/40 hover:bg-navy/5 hover:text-navy"
        >
          나중에 확인하기
        </button>
      </div>
    </>
  );
}
