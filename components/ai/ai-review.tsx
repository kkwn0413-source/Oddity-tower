"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fmtMD, parseDate } from "@/lib/dates";
import { ACTION_LABEL, fieldLines, type AiItem, type AiSet } from "./types";

/**
 * AI 일정 반영 — 대표 화면.
 * 자료 입력 → /api/ai/parse → 변경안 세트 목록(당사자 확인 상태 취합) →
 * 항목 선택 후 최종 컨펌 → 실제 tasks CRUD (이견 항목은 기본 제외).
 */

type Member = { id: string; name: string; role: string; color: string };
type ProjectOpt = { id: string; code: string; name: string };

export function AiReview({
  sets,
  items,
  team,
  projects,
  meId,
}: {
  sets: AiSet[];
  items: AiItem[];
  team: Member[];
  projects: ProjectOpt[];
  meId: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [source, setSource] = useState("");
  const [parsing, setParsing] = useState(false);
  const [applying, setApplying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 반영 제외 체크 상태 — 기본: 이견(disputed) 항목만 제외
  const [excluded, setExcluded] = useState<Set<string>>(
    () => new Set(items.filter((i) => i.ack_status === "disputed").map((i) => i.id)),
  );

  const nameOf = (id: string | null) => team.find((t) => t.id === id)?.name ?? "미지정";
  const colorOf = (id: string | null) => team.find((t) => t.id === id)?.color ?? "#9B9B9B";
  const codeOf = (id: string | null) => projects.find((p) => p.id === id)?.code ?? "?";

  function logEvent(type: string, payload: Record<string, string | number | boolean | null>) {
    supabase
      .from("events")
      .insert({ actor_id: meId, type, payload })
      .then(({ error: e }) => e && console.warn("이벤트 기록 실패:", e.message));
  }

  async function parse() {
    if (!source.trim() || parsing) return;
    setParsing(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: source }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "해석에 실패했습니다.");
      setSource("");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setParsing(false);
    }
  }

  async function applySet(set: AiSet) {
    const setItems = items.filter((i) => i.set_id === set.id);
    const selected = setItems.filter((i) => !excluded.has(i.id));
    if (selected.length === 0) return alert("반영할 항목이 없습니다.");
    const disputedIncluded = selected.filter((i) => i.ack_status === "disputed").length;
    if (
      !window.confirm(
        `${selected.length}건을 실제 일정에 반영할까요?` +
          (disputedIncluded ? ` (이견 ${disputedIncluded}건 포함)` : ""),
      )
    )
      return;
    setApplying(set.id);
    try {
      for (const it of selected) {
        if (it.action === "create") {
          const f = it.payload;
          const { data: created, error: e } = await supabase
            .from("tasks")
            .insert({
              project_id: it.project_id!,
              name: f.name!,
              description: f.description ?? null,
              assignee_id: f.assignee_id ?? it.assignee_id,
              start_date: f.start_date!,
              end_date: f.end_date!,
              status: f.status ?? "wait",
              sort_order: 99,
            })
            .select()
            .single();
          if (e) throw new Error(`"${it.summary}" 생성 실패: ${e.message}`);
          logEvent("task.created", { task_id: created.id, name: f.name!, via: "ai" });
        } else if (it.action === "update" && it.task_id) {
          const patch: Partial<{
            name: string;
            description: string;
            start_date: string;
            end_date: string;
            status: string;
            assignee_id: string;
          }> = {};
          for (const k of ["name", "description", "start_date", "end_date", "status", "assignee_id"] as const) {
            const v = it.payload[k];
            if (v !== undefined && v !== null) patch[k] = v;
          }
          const { error: e } = await supabase.from("tasks").update(patch).eq("id", it.task_id);
          if (e) throw new Error(`"${it.summary}" 수정 실패: ${e.message}`);
          logEvent("task.updated", { task_id: it.task_id, via: "ai", summary: it.summary });
        } else if (it.action === "delete" && it.task_id) {
          const { error: e } = await supabase.from("tasks").delete().eq("id", it.task_id);
          if (e) throw new Error(`"${it.summary}" 삭제 실패: ${e.message}`);
          logEvent("task.removed", { task_id: it.task_id, via: "ai", summary: it.summary });
        }
        await supabase.from("ai_change_items").update({ applied: true }).eq("id", it.id);
      }
      await supabase
        .from("ai_change_sets")
        .update({ status: "applied", applied_at: new Date().toISOString() })
        .eq("id", set.id);
      logEvent("ai.applied", {
        set_id: set.id,
        applied: selected.length,
        skipped: setItems.length - selected.length,
      });
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setApplying(null);
    }
  }

  async function cancelSet(set: AiSet) {
    if (!window.confirm("이 변경안을 취소할까요? (일정은 바뀌지 않습니다)")) return;
    const { error: e } = await supabase
      .from("ai_change_sets")
      .update({ status: "cancelled" })
      .eq("id", set.id);
    if (e) return alert("취소 실패: " + e.message);
    logEvent("ai.cancelled", { set_id: set.id });
    router.refresh();
  }

  const input =
    "w-full rounded-md border border-navy/15 bg-white px-2.5 py-1.5 text-sm text-navy outline-none focus:border-gold focus:ring-1 focus:ring-gold/25";

  const ackBadge = (it: AiItem) =>
    it.ack_status === "agreed" ? (
      <span className="rounded bg-[#1D9E75]/15 px-1.5 py-px text-[10px] font-bold text-[#1D9E75]">확인됨</span>
    ) : it.ack_status === "disputed" ? (
      <span className="rounded bg-danger/10 px-1.5 py-px text-[10px] font-bold text-danger">이견</span>
    ) : (
      <span className="rounded bg-navy/8 px-1.5 py-px text-[10px] font-bold text-navy/40">응답 대기</span>
    );

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold text-navy">AI 일정 반영</h1>
        <p className="mt-0.5 text-xs text-navy/45">
          자료를 넣으면 AI가 변경안을 만들고 → 당사자에게 확인 팝업이 가고 → 응답을 취합해 대표가
          컨펌하면 실제 일정에 반영됩니다.
        </p>
      </div>

      {/* 자료 입력 */}
      <div className="rounded-xl bg-card p-4 shadow-sm">
        <textarea
          className={input + " min-h-32 resize-y"}
          placeholder={
            "회의록·메신저 대화·이메일 등 일정 관련 자료를 그대로 붙여넣으세요.\n예) 존2 라벨 시안 마감 7/20으로 연기, 펭귄상회 캐릭터 리파인은 최서우 → 박한나로 변경..."
          }
          value={source}
          onChange={(e) => setSource(e.target.value)}
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={parse}
            disabled={parsing || !source.trim()}
            className="rounded-md bg-navy px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {parsing ? "해석 중... (수십 초 걸릴 수 있음)" : "AI로 해석"}
          </button>
          {error && <span className="text-xs text-danger">{error}</span>}
        </div>
      </div>

      {/* 변경안 세트 목록 */}
      {sets.map((set) => {
        const setItems = items.filter((i) => i.set_id === set.id);
        const pending = setItems.filter((i) => i.ack_status === "pending" && i.assignee_id).length;
        const isOpen = set.status === "proposed";
        return (
          <div key={set.id} className="rounded-xl bg-card p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <span
                className={
                  "rounded px-1.5 py-0.5 text-[10px] font-bold " +
                  (set.status === "applied"
                    ? "bg-[#1D9E75]/15 text-[#1D9E75]"
                    : set.status === "cancelled"
                      ? "bg-navy/8 text-navy/40"
                      : "bg-gold/15 text-gold")
                }
              >
                {set.status === "applied" ? "반영됨" : set.status === "cancelled" ? "취소됨" : "컨펌 대기"}
              </span>
              <span className="text-[11px] text-navy/40">
                {fmtMD(parseDate(set.created_at.slice(0, 10)))}
                {isOpen && pending > 0 && ` · 당사자 응답 대기 ${pending}건`}
              </span>
            </div>
            <p className="mt-1.5 text-[13px] font-semibold leading-relaxed text-navy">{set.summary}</p>
            {set.notes && (
              <p className="mt-1 rounded-md bg-gold/8 px-2.5 py-1.5 text-xs leading-relaxed text-navy/60">
                ⚠ {set.notes}
              </p>
            )}

            <div className="mt-2.5 flex flex-col gap-1.5">
              {setItems.map((it) => (
                <div key={it.id} className="flex items-start gap-2 rounded-lg bg-bg/70 px-3 py-2">
                  {isOpen && (
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={!excluded.has(it.id)}
                      onChange={(e) => {
                        const next = new Set(excluded);
                        if (e.target.checked) next.delete(it.id);
                        else next.add(it.id);
                        setExcluded(next);
                      }}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-navy/45">
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
                      <span className="rounded bg-navy/8 px-1 py-px text-[9px] font-bold text-navy/55">
                        {codeOf(it.project_id)}
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: colorOf(it.assignee_id) }} />
                        {nameOf(it.assignee_id)}
                      </span>
                      {it.assignee_id ? ackBadge(it) : (
                        <span className="rounded bg-navy/8 px-1.5 py-px text-[10px] text-navy/35">확인 불필요</span>
                      )}
                      {set.status === "applied" && (
                        <span className="text-[10px] text-navy/35">{it.applied ? "· 반영됨" : "· 제외됨"}</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-navy/85">{it.summary}</p>
                    {fieldLines(it).map((l, k) => (
                      <p key={k} className="text-[11px] text-navy/50">{l}</p>
                    ))}
                    {it.ack_comment && (
                      <p className="mt-0.5 rounded bg-danger/5 px-2 py-1 text-[11px] text-danger">
                        이견: {it.ack_comment}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {isOpen && (
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() => applySet(set)}
                  disabled={applying === set.id}
                  className="rounded-md bg-gold px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                  {applying === set.id ? "반영 중..." : "최종 컨펌 — 선택 항목 반영"}
                </button>
                <button
                  onClick={() => cancelSet(set)}
                  className="rounded-md border border-navy/15 px-4 py-2 text-sm text-navy/60 hover:text-navy"
                >
                  취소
                </button>
                <span className="text-[11px] text-navy/40">이견 항목은 기본으로 체크 해제됩니다</span>
              </div>
            )}
          </div>
        );
      })}
      {sets.length === 0 && (
        <p className="rounded-xl border border-dashed border-navy/15 px-4 py-8 text-center text-sm text-navy/35">
          아직 변경안이 없습니다. 위에 자료를 붙여넣고 &quot;AI로 해석&quot;을 눌러보세요.
        </p>
      )}
    </div>
  );
}
