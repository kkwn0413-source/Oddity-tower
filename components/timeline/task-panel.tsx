"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fmtMD, parseDate } from "@/lib/dates";
import type { TLProfile, TLProject, TLTask } from "./types";

/**
 * 태스크 상세 패널 (스펙 6.1 우측 슬라이드).
 * - freelancer: 본인 태스크 상태 변경 + 코멘트 (RLS·trigger가 그 외 차단)
 * - director: 전체 편집(기간·담당·설명·상태), 단가(대표 전용 — 데이터도
 *   director 세션에서만 fetch), 태스크 생성/삭제, internal 코멘트
 */

export type PanelMode =
  | { type: "edit"; task: TLTask }
  | { type: "create"; projectId?: string };

type Finance = {
  fee: number | null;
  withholding: boolean;
  paid_at: string | null;
  memo: string | null;
};

type Comment = {
  id: string;
  author_id: string;
  body: string;
  internal: boolean;
  created_at: string;
};

const STATUS_LABEL: Record<string, string> = {
  wait: "대기",
  active: "진행 중",
  done: "완료",
};

export function TaskPanel({
  mode,
  projects,
  team,
  meId,
  isDirector,
  onClose,
}: {
  mode: PanelMode;
  projects: TLProject[];
  team: TLProfile[];
  meId: string;
  isDirector: boolean;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const editing = mode.type === "edit" ? mode.task : null;

  // ----- 폼 상태 -----
  const [name, setName] = useState(editing?.name ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [projectId, setProjectId] = useState(
    editing?.project_id ?? (mode.type === "create" ? (mode.projectId ?? projects[0]?.id ?? "") : ""),
  );
  const [assigneeId, setAssigneeId] = useState<string | null>(
    editing?.assignee_id ?? meId,
  );
  const [startDate, setStartDate] = useState(editing?.start_date ?? "");
  const [endDate, setEndDate] = useState(editing?.end_date ?? "");
  const [status, setStatus] = useState(editing?.status ?? "wait");
  const [saving, setSaving] = useState(false);

  // ----- 단가 (director 전용 — fetch 자체를 안 함) -----
  const [finance, setFinance] = useState<Finance | null>(
    // 생성 모드에선 즉시 빈 폼 (fetch 불필요)
    isDirector && !editing
      ? { fee: null, withholding: true, paid_at: null, memo: null }
      : null,
  );
  const [financeLoaded, setFinanceLoaded] = useState(!isDirector || !editing);

  // ----- 코멘트 -----
  const [comments, setComments] = useState<Comment[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [commentInternal, setCommentInternal] = useState(false);

  const project = projects.find((p) => p.id === (editing?.project_id ?? projectId));
  const nameOf = useCallback(
    (id: string | null) => team.find((t) => t.id === id)?.name ?? "?",
    [team],
  );
  const colorOf = useCallback(
    (id: string | null) => team.find((t) => t.id === id)?.color ?? "#9B9B9B",
    [team],
  );

  // director만 단가 로드 (비동기 완료 후 상태 반영)
  useEffect(() => {
    if (!isDirector || !editing) return;
    let cancelled = false;
    supabase
      .from("task_finance")
      .select("fee, withholding, paid_at, memo")
      .eq("task_id", editing.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        setFinance(data ?? { fee: null, withholding: true, paid_at: null, memo: null });
        setFinanceLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, isDirector, editing]);

  const loadComments = useCallback(async () => {
    if (!editing) return;
    const { data } = await supabase
      .from("comments")
      .select("id, author_id, body, internal, created_at")
      .eq("task_id", editing.id)
      .order("created_at");
    setComments(data ?? []);
  }, [supabase, editing]);

  useEffect(() => {
    let cancelled = false;
    if (!editing) return;
    supabase
      .from("comments")
      .select("id, author_id, body, internal, created_at")
      .eq("task_id", editing.id)
      .order("created_at")
      .then(({ data }) => {
        if (!cancelled) setComments(data ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, editing]);

  function logEvent(type: string, payload: Record<string, string | number | boolean | null>) {
    supabase
      .from("events")
      .insert({
        actor_id: meId,
        project_id: editing?.project_id ?? projectId ?? null,
        task_id: editing?.id ?? null,
        type,
        payload,
      })
      .then(({ error }) => error && console.warn("이벤트 기록 실패:", error.message));
  }

  // ---------------------------------------------------------------------------
  async function changeStatus(next: string) {
    if (!editing) {
      setStatus(next);
      return;
    }
    const prev = status;
    setStatus(next);
    const { error } = await supabase.from("tasks").update({ status: next }).eq("id", editing.id);
    if (error) {
      setStatus(prev);
      alert("상태 변경 실패: " + error.message);
      return;
    }
    logEvent("task.status_changed", { before: prev, after: next, name: editing.name });
    router.refresh();
  }

  async function saveDirectorEdit() {
    if (!isDirector) return;
    if (!name.trim() || !startDate || !endDate || !projectId) {
      alert("이름·프로젝트·기간은 필수입니다.");
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const { error } = await supabase
          .from("tasks")
          .update({
            name: name.trim(),
            description: description.trim() || null,
            project_id: projectId,
            assignee_id: assigneeId || null,
            start_date: startDate,
            end_date: endDate,
            status,
          })
          .eq("id", editing.id);
        if (error) throw new Error(error.message);
        logEvent("task.updated", { name: name.trim() });
        await saveFinance(editing.id);
      } else {
        const { data: created, error } = await supabase
          .from("tasks")
          .insert({
            name: name.trim(),
            description: description.trim() || null,
            project_id: projectId,
            assignee_id: assigneeId || null,
            start_date: startDate,
            end_date: endDate,
            status,
            sort_order: 99,
          })
          .select()
          .single();
        if (error) throw new Error(error.message);
        logEvent("task.created", { task_id: created.id, name: name.trim() });
        await saveFinance(created.id);
      }
      router.refresh();
      onClose();
    } catch (e) {
      alert("저장 실패: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function saveFinance(taskId: string) {
    if (!isDirector || !finance) return;
    const { error } = await supabase.from("task_finance").upsert({
      task_id: taskId,
      fee: finance.fee,
      withholding: finance.withholding,
      paid_at: finance.paid_at,
      memo: finance.memo,
    });
    if (error) throw new Error("단가 저장 실패: " + error.message);
    logEvent("finance.updated", { task_id: taskId, fee: finance.fee });
  }

  async function removeTask() {
    if (!editing || !isDirector) return;
    if (!window.confirm(`"${editing.name}" 태스크를 삭제할까요? (파일·코멘트 포함)`)) return;
    const { error } = await supabase.from("tasks").delete().eq("id", editing.id);
    if (error) {
      alert("삭제 실패: " + error.message);
      return;
    }
    logEvent("task.removed", { name: editing.name });
    router.refresh();
    onClose();
  }

  async function addComment() {
    if (!editing || commentBody.trim() === "") return;
    const { error } = await supabase.from("comments").insert({
      task_id: editing.id,
      author_id: meId,
      body: commentBody.trim(),
      internal: isDirector ? commentInternal : false,
    });
    if (error) {
      alert("코멘트 등록 실패: " + error.message);
      return;
    }
    logEvent("comment.added", { task_id: editing.id, internal: isDirector && commentInternal });
    setCommentBody("");
    setCommentInternal(false);
    await loadComments();
  }

  // ---------------------------------------------------------------------------
  const input =
    "w-full rounded-md border border-navy/15 bg-white px-2.5 py-1.5 text-sm text-navy outline-none focus:border-gold focus:ring-1 focus:ring-gold/25";
  const label = "text-[11px] font-semibold uppercase tracking-wider text-navy/40";

  return (
    <>
      <div className="fixed inset-0 z-40 bg-navy/20" onClick={onClose} />
      <aside className="fixed bottom-0 right-0 top-14 z-50 flex w-full max-w-[440px] flex-col overflow-y-auto border-l border-black/10 bg-card shadow-2xl">
        {/* 헤더 */}
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-navy/10 bg-card px-5 py-3.5">
          {project && (
            <span className="rounded bg-navy/8 px-1.5 py-0.5 text-[10px] font-bold text-navy/55">
              {project.code}
            </span>
          )}
          <span className="truncate text-[15px] font-bold text-navy">
            {editing ? editing.name : "새 태스크"}
          </span>
          <button
            onClick={onClose}
            className="ml-auto rounded-md px-2 py-1 text-sm text-navy/40 hover:bg-navy/5 hover:text-navy"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        <div className="flex flex-col gap-5 px-5 py-4">
          {/* 상태 */}
          <section>
            <div className={label}>상태</div>
            <div className="mt-1.5 flex gap-1.5">
              {(["wait", "active", "done"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => changeStatus(s)}
                  className={
                    "rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors " +
                    (status === s
                      ? s === "done"
                        ? "border-navy/30 bg-navy/10 text-navy"
                        : s === "active"
                          ? "border-gold bg-gold text-white"
                          : "border-navy/30 bg-white text-navy"
                      : "border-navy/10 text-navy/40 hover:text-navy")
                  }
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </section>

          {/* 기본 정보 */}
          {isDirector ? (
            <section className="flex flex-col gap-3">
              <div>
                <div className={label}>태스크 이름</div>
                <input className={input + " mt-1"} value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className={label}>프로젝트</div>
                  <select className={input + " mt-1"} value={projectId} onChange={(e) => setProjectId(e.target.value)}>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        [{p.code}] {p.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className={label}>담당</div>
                  <select className={input + " mt-1"} value={assigneeId ?? ""} onChange={(e) => setAssigneeId(e.target.value || null)}>
                    <option value="">미배정</option>
                    {team.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                        {t.role === "director" ? " (대표)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className={label}>시작일</div>
                  <input type="date" className={input + " mt-1"} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div>
                  <div className={label}>마감일</div>
                  <input type="date" className={input + " mt-1"} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </div>
              <div>
                <div className={label}>설명</div>
                <textarea
                  className={input + " mt-1 min-h-16 resize-y"}
                  value={description ?? ""}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="작업 범위, 참고 사항"
                />
              </div>
            </section>
          ) : (
            editing && (
              <section className="flex flex-col gap-2 text-sm text-navy/70">
                <div className="flex items-center gap-2">
                  <span className={label}>기간</span>
                  <span>
                    {fmtMD(parseDate(editing.start_date))} — {fmtMD(parseDate(editing.end_date))}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={label}>담당</span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colorOf(editing.assignee_id) }} />
                    {nameOf(editing.assignee_id)}
                  </span>
                </div>
                {editing.description && (
                  <p className="mt-1 rounded-md bg-bg/70 px-3 py-2 text-[13px] leading-relaxed">{editing.description}</p>
                )}
              </section>
            )
          )}

          {/* 단가 — director 전용 (freelancer는 데이터 자체가 안 내려옴) */}
          {isDirector && financeLoaded && finance && (
            <section className="rounded-xl border border-gold/30 bg-gold/5 p-3.5">
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-gold">단가 · 정산</span>
                <span className="text-[10px] text-navy/35">대표에게만 보입니다</span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-3">
                <div>
                  <div className={label}>단가 (원)</div>
                  <input
                    type="number"
                    className={input + " mt-1"}
                    value={finance.fee ?? ""}
                    onChange={(e) => setFinance({ ...finance, fee: e.target.value === "" ? null : Number(e.target.value) })}
                  />
                </div>
                <div>
                  <div className={label}>지급일</div>
                  <input
                    type="date"
                    className={input + " mt-1"}
                    value={finance.paid_at ?? ""}
                    onChange={(e) => setFinance({ ...finance, paid_at: e.target.value || null })}
                  />
                </div>
              </div>
              <label className="mt-2 flex items-center gap-1.5 text-xs text-navy/60">
                <input
                  type="checkbox"
                  checked={finance.withholding}
                  onChange={(e) => setFinance({ ...finance, withholding: e.target.checked })}
                />
                원천징수 3.3%
              </label>
              <input
                className={input + " mt-2"}
                placeholder="정산 메모"
                value={finance.memo ?? ""}
                onChange={(e) => setFinance({ ...finance, memo: e.target.value || null })}
              />
            </section>
          )}

          {/* director 저장/삭제 */}
          {isDirector && (
            <div className="flex gap-2">
              <button
                onClick={saveDirectorEdit}
                disabled={saving}
                className="rounded-md bg-navy px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "저장 중..." : editing ? "저장" : "태스크 생성"}
              </button>
              {editing && (
                <button
                  onClick={removeTask}
                  className="rounded-md border border-danger/30 px-4 py-2 text-sm text-danger hover:bg-danger/5"
                >
                  삭제
                </button>
              )}
            </div>
          )}

          {/* 파일 (6단계) */}
          {editing && (
            <section>
              <div className={label}>파일</div>
              <p className="mt-1.5 rounded-md border border-dashed border-navy/15 px-3 py-3 text-xs text-navy/35">
                파일 업로드·Drive/Figma 링크는 6단계에서 여기에 붙습니다.
              </p>
            </section>
          )}

          {/* 코멘트 */}
          {editing && (
            <section>
              <div className={label}>코멘트</div>
              <div className="mt-1.5 flex flex-col gap-2">
                {comments.map((c) => (
                  <div key={c.id} className="rounded-lg bg-bg/70 px-3 py-2">
                    <div className="flex items-center gap-1.5 text-[11px] text-navy/45">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: colorOf(c.author_id) }} />
                      <span className="font-semibold text-navy/70">{nameOf(c.author_id)}</span>
                      <span>{fmtMD(parseDate(c.created_at.slice(0, 10)))}</span>
                      {c.internal && (
                        <span className="rounded bg-navy/10 px-1 py-px text-[9px] font-bold text-navy/60">🔒 내부</span>
                      )}
                    </div>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-navy/85">{c.body}</p>
                  </div>
                ))}
                {comments.length === 0 && <p className="text-xs text-navy/35">아직 코멘트가 없습니다.</p>}
                <div className="flex flex-col gap-1.5">
                  <textarea
                    className={input + " min-h-14 resize-y"}
                    placeholder="코멘트 남기기"
                    value={commentBody}
                    onChange={(e) => setCommentBody(e.target.value)}
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={addComment}
                      className="rounded-md bg-navy px-3.5 py-1.5 text-xs font-medium text-white hover:opacity-90"
                    >
                      등록
                    </button>
                    {isDirector && (
                      <label className="flex items-center gap-1 text-[11px] text-navy/50">
                        <input
                          type="checkbox"
                          checked={commentInternal}
                          onChange={(e) => setCommentInternal(e.target.checked)}
                        />
                        🔒 내부 전용 (공유 링크·프리랜서 제외)
                      </label>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>
      </aside>
    </>
  );
}
