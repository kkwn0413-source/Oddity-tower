"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fmtMD, parseDate } from "@/lib/dates";
import type { TLManager, TLProfile, TLProject } from "./types";

/**
 * 프로젝트 관리자 세팅 (director 전용 — 사용자 확장 2026-07-08).
 * 최대 6명(DB trigger도 강제). 관리자는 담당 프로젝트의 태스크·마일스톤을
 * 생성·수정·삭제할 수 있다. 누가 언제 지정했는지 함께 표시.
 */
export function ManagerModal({
  project,
  team,
  managers,
  meId,
  onClose,
}: {
  project: TLProject;
  team: TLProfile[];
  managers: TLManager[];
  meId: string;
  onClose: () => void;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [rows, setRows] = useState<TLManager[]>(
    managers.filter((m) => m.project_id === project.id),
  );
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);

  const nameOf = (id: string | null) => team.find((t) => t.id === id)?.name ?? "?";
  const colorOf = (id: string | null) => team.find((t) => t.id === id)?.color ?? "#9B9B9B";

  // director는 이미 전권 — 후보는 아직 관리자가 아닌 freelancer만
  const candidates = team.filter(
    (t) => t.role !== "director" && !rows.some((m) => m.profile_id === t.id),
  );

  function logEvent(type: string, payload: Record<string, string | number | boolean | null>) {
    supabase
      .from("events")
      .insert({ actor_id: meId, project_id: project.id, type, payload })
      .then(({ error }) => error && console.warn("이벤트 기록 실패:", error.message));
  }

  async function addManager() {
    if (!pick) return;
    if (rows.length >= 6) {
      alert("프로젝트 관리자는 최대 6명까지입니다.");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase
      .from("project_managers")
      .insert({ project_id: project.id, profile_id: pick, assigned_by: meId })
      .select()
      .single();
    setBusy(false);
    if (error) {
      alert("지정 실패: " + error.message);
      return;
    }
    logEvent("manager.added", { profile_id: pick, name: nameOf(pick) });
    setRows((prev) => [...prev, data]);
    setPick("");
    router.refresh();
  }

  async function removeManager(m: TLManager) {
    if (!window.confirm(`${nameOf(m.profile_id)} 님을 관리자에서 해제할까요?`)) return;
    const { error } = await supabase
      .from("project_managers")
      .delete()
      .eq("project_id", m.project_id)
      .eq("profile_id", m.profile_id);
    if (error) {
      alert("해제 실패: " + error.message);
      return;
    }
    logEvent("manager.removed", { profile_id: m.profile_id, name: nameOf(m.profile_id) });
    setRows((prev) => prev.filter((r) => r.profile_id !== m.profile_id));
    router.refresh();
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-navy/25" onClick={onClose} />
      <div className="fixed left-1/2 top-1/2 z-50 w-[min(420px,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-card p-5 shadow-2xl">
        <div className="flex items-center gap-2">
          <span className="rounded bg-navy/8 px-1.5 py-0.5 text-[10px] font-bold text-navy/55">
            {project.code}
          </span>
          <span className="text-[15px] font-bold text-navy">프로젝트 관리자</span>
          <span className="text-[11px] text-navy/40">{rows.length}/6</span>
          <button
            onClick={onClose}
            className="ml-auto rounded-md px-2 py-1 text-sm text-navy/40 hover:bg-navy/5 hover:text-navy"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>
        <p className="mt-1 text-xs text-navy/45">
          관리자는 이 프로젝트의 태스크·마일스톤을 생성·수정·삭제할 수 있습니다. (단가·선발주 제외)
        </p>

        <div className="mt-3 flex flex-col gap-1.5">
          {rows.map((m) => (
            <div key={m.profile_id} className="flex items-center gap-2 rounded-lg bg-bg/70 px-3 py-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: colorOf(m.profile_id) }} />
              <span className="text-[13px] font-semibold text-navy">{nameOf(m.profile_id)}</span>
              <span className="ml-auto text-[10px] text-navy/40">
                지정: {nameOf(m.assigned_by)} · {fmtMD(parseDate(m.created_at.slice(0, 10)))}
              </span>
              <button
                onClick={() => removeManager(m)}
                className="rounded px-1 text-xs text-navy/30 hover:text-danger"
                aria-label="해제"
              >
                ✕
              </button>
            </div>
          ))}
          {rows.length === 0 && (
            <p className="rounded-md border border-dashed border-navy/15 px-3 py-3 text-xs text-navy/35">
              아직 지정된 관리자가 없습니다.
            </p>
          )}
        </div>

        <div className="mt-3 flex gap-1.5">
          <select
            className="w-full rounded-md border border-navy/15 bg-white px-2.5 py-1.5 text-sm text-navy outline-none focus:border-gold"
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            disabled={rows.length >= 6}
          >
            <option value="">관리자 추가...</option>
            {candidates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button
            onClick={addManager}
            disabled={!pick || busy || rows.length >= 6}
            className="shrink-0 rounded-md bg-navy px-3.5 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            지정
          </button>
        </div>
      </div>
    </>
  );
}
