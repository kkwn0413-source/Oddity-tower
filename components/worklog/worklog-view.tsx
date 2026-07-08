"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toISO, today, WEEKDAYS_KO, parseDate } from "@/lib/dates";

/**
 * 업무일지 화면.
 * - 본인: 작성·수정·삭제 (RLS가 타인 일지 차단)
 * - 대표: 인원 필터로 전원 열람 + HTML 다운로드/PDF 저장(인쇄)
 * - 실제 업무시간(hours)은 비고와 함께 개인이 직접 기입 — 금액 정산 기준
 */

type WorkLog = {
  id: string;
  author_id: string;
  work_date: string;
  project_id: string | null;
  content: string;
  hours: number | null;
  note: string | null;
};

type Member = { id: string; name: string; role: string; color: string };
type ProjectOpt = { id: string; code: string; name: string };

function monthOf(iso: string) {
  return iso.slice(0, 7);
}

function fmtMonth(ym: string) {
  const [y, m] = ym.split("-");
  return `${y}년 ${Number(m)}월`;
}

function fmtDateW(iso: string) {
  const d = parseDate(iso);
  return `${d.getMonth() + 1}/${d.getDate()} (${WEEKDAYS_KO[d.getDay()]})`;
}

export function WorklogView({
  initialLogs,
  team,
  projects,
  meId,
  meName,
  isDirector,
}: {
  initialLogs: WorkLog[];
  team: Member[];
  projects: ProjectOpt[];
  meId: string;
  meName: string;
  isDirector: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [logs, setLogs] = useState<WorkLog[]>(initialLogs);
  const [person, setPerson] = useState<string>(isDirector ? "all" : meId);
  const [month, setMonth] = useState<string>(monthOf(toISO(today())));
  const [editId, setEditId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // ----- 작성/수정 폼 -----
  const empty = {
    work_date: toISO(today()),
    project_id: "" as string,
    content: "",
    hours: "" as string,
    note: "",
  };
  const [form, setForm] = useState(empty);

  const nameOf = (id: string | null) => team.find((t) => t.id === id)?.name ?? "?";
  const colorOf = (id: string | null) => team.find((t) => t.id === id)?.color ?? "#9B9B9B";
  const projectOf = (id: string | null) => projects.find((p) => p.id === id);

  const visible = useMemo(
    () =>
      logs
        .filter((l) => (person === "all" ? true : l.author_id === person))
        .filter((l) => monthOf(l.work_date) === month),
    [logs, person, month],
  );
  const totalHours = visible.reduce((s, l) => s + (l.hours ?? 0), 0);

  function logEvent(type: string, payload: Record<string, string | number | boolean | null>) {
    // 일지 내용·시간은 본인+대표 전용 — events payload에는 날짜만 남긴다
    supabase
      .from("events")
      .insert({ actor_id: meId, type, payload })
      .then(({ error }) => error && console.warn("이벤트 기록 실패:", error.message));
  }

  async function save() {
    if (!form.content.trim() || !form.work_date) {
      alert("날짜와 내용은 필수입니다.");
      return;
    }
    const hours = form.hours === "" ? null : Number(form.hours);
    if (hours !== null && (isNaN(hours) || hours < 0 || hours > 24)) {
      alert("실제 업무시간은 0~24 사이 숫자로 입력해주세요.");
      return;
    }
    setBusy(true);
    const row = {
      work_date: form.work_date,
      project_id: form.project_id || null,
      content: form.content.trim(),
      hours,
      note: form.note.trim() || null,
    };
    if (editId) {
      const { data, error } = await supabase
        .from("work_logs")
        .update(row)
        .eq("id", editId)
        .select("id, author_id, work_date, project_id, content, hours, note")
        .single();
      setBusy(false);
      if (error) return alert("수정 실패: " + error.message);
      setLogs((prev) => prev.map((l) => (l.id === editId ? data : l)));
      logEvent("worklog.updated", { work_date: form.work_date });
      setEditId(null);
    } else {
      const { data, error } = await supabase
        .from("work_logs")
        .insert({ ...row, author_id: meId })
        .select("id, author_id, work_date, project_id, content, hours, note")
        .single();
      setBusy(false);
      if (error) return alert("저장 실패: " + error.message);
      setLogs((prev) => [data, ...prev]);
      logEvent("worklog.created", { work_date: form.work_date });
    }
    setForm(empty);
  }

  function startEdit(l: WorkLog) {
    setEditId(l.id);
    setForm({
      work_date: l.work_date,
      project_id: l.project_id ?? "",
      content: l.content,
      hours: l.hours === null ? "" : String(l.hours),
      note: l.note ?? "",
    });
  }

  async function remove(l: WorkLog) {
    if (!window.confirm(`${fmtDateW(l.work_date)} 일지를 삭제할까요?`)) return;
    const { error } = await supabase.from("work_logs").delete().eq("id", l.id);
    if (error) return alert("삭제 실패: " + error.message);
    setLogs((prev) => prev.filter((x) => x.id !== l.id));
    logEvent("worklog.removed", { work_date: l.work_date });
    if (editId === l.id) {
      setEditId(null);
      setForm(empty);
    }
  }

  // ----- 추출 (HTML 다운로드 / 인쇄→PDF 저장) -----
  function buildExportHtml() {
    const personLabel = person === "all" ? "전체 인원" : nameOf(person);
    const rows = visible
      .map(
        (l) => `<tr>
  <td>${fmtDateW(l.work_date)}</td>
  <td>${person === "all" ? escapeHtml(nameOf(l.author_id)) : ""}${person === "all" ? "" : ""}</td>
  <td>${l.project_id ? escapeHtml(projectOf(l.project_id)?.code ?? "") : "—"}</td>
  <td class="content">${escapeHtml(l.content)}</td>
  <td class="num">${l.hours ?? "—"}</td>
  <td class="content">${escapeHtml(l.note ?? "")}</td>
</tr>`,
      )
      .join("\n");
    return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<title>업무일지 ${personLabel} ${fmtMonth(month)}</title>
<style>
  body { font-family: Pretendard, "Apple SD Gothic Neo", sans-serif; color: #0B1530; margin: 40px; }
  h1 { font-size: 20px; } .meta { color: #666; font-size: 13px; margin-bottom: 16px; }
  table { border-collapse: collapse; width: 100%; font-size: 13px; }
  th, td { border: 1px solid #d9d5cc; padding: 7px 9px; text-align: left; vertical-align: top; }
  th { background: #F6F4EF; font-size: 12px; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  td.content { white-space: pre-wrap; }
  tfoot td { font-weight: 700; background: #FBF8F2; }
  @media print { body { margin: 12mm; } }
</style></head><body>
<h1>오디티하우스 업무일지 — ${personLabel}</h1>
<div class="meta">${fmtMonth(month)} · 총 ${visible.length}건 · 실제 업무시간 합계 ${totalHours}h · 추출: ${meName}, ${toISO(today())}</div>
<table>
<thead><tr><th>날짜</th><th>작성자</th><th>프로젝트</th><th>업무 내용</th><th class="num">실제 업무시간</th><th>비고</th></tr></thead>
<tbody>
${rows || '<tr><td colspan="6">기록 없음</td></tr>'}
</tbody>
<tfoot><tr><td colspan="4">합계</td><td class="num">${totalHours}h</td><td></td></tr></tfoot>
</table>
</body></html>`;
  }

  function escapeHtml(s: string) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function downloadHtml() {
    const blob = new Blob([buildExportHtml()], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `업무일지_${person === "all" ? "전체" : nameOf(person)}_${month}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function printPdf() {
    const w = window.open("", "_blank", "noopener,width=900,height=700");
    if (!w) return alert("팝업이 차단됐습니다. 팝업을 허용해주세요.");
    w.document.write(buildExportHtml());
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  }

  // ---------------------------------------------------------------------------
  const input =
    "rounded-md border border-navy/15 bg-white px-2.5 py-1.5 text-sm text-navy outline-none focus:border-gold focus:ring-1 focus:ring-gold/25";
  const label = "text-[11px] font-semibold uppercase tracking-wider text-navy/40";

  const months = useMemo(() => {
    const set = new Set(logs.map((l) => monthOf(l.work_date)));
    set.add(monthOf(toISO(today())));
    return [...set].sort().reverse();
  }, [logs]);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-navy">업무일지</h1>
        <span className="text-xs text-navy/40">
          {isDirector ? "전원 열람 (대표) — 정산 기준: 실제 업무시간" : "본인과 대표만 볼 수 있습니다"}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <select className={input} value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {fmtMonth(m)}
              </option>
            ))}
          </select>
          <button
            onClick={downloadHtml}
            className="rounded-md border border-navy/15 px-3 py-1.5 text-xs font-medium text-navy/60 hover:text-navy"
          >
            HTML 다운로드
          </button>
          <button
            onClick={printPdf}
            className="rounded-md bg-navy px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
          >
            PDF로 저장
          </button>
        </div>
      </div>

      {/* 대표: 인원 필터 */}
      {isDirector && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-card p-2 shadow-sm">
          <button
            onClick={() => setPerson("all")}
            className={
              "rounded-md px-2.5 py-1 text-xs font-medium " +
              (person === "all" ? "bg-navy text-white" : "text-navy/50 hover:bg-navy/5")
            }
          >
            전체
          </button>
          {team.map((t) => (
            <button
              key={t.id}
              onClick={() => setPerson(t.id)}
              className={
                "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium " +
                (person === t.id ? "bg-navy text-white" : "text-navy/50 hover:bg-navy/5")
              }
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />
              {t.name}
            </button>
          ))}
          <span className="ml-auto pr-2 text-xs tabular-nums text-navy/50">
            {fmtMonth(month)} 합계 <b className="text-navy">{totalHours}h</b> · {visible.length}건
          </span>
        </div>
      )}

      {/* 작성 폼 */}
      <div className="rounded-xl bg-card p-4 shadow-sm">
        <div className={label}>{editId ? "일지 수정" : "오늘의 일지"}</div>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div>
            <div className={label}>날짜</div>
            <input
              type="date"
              className={input + " mt-1 w-full"}
              value={form.work_date}
              onChange={(e) => setForm({ ...form, work_date: e.target.value })}
            />
          </div>
          <div>
            <div className={label}>프로젝트 (선택)</div>
            <select
              className={input + " mt-1 w-full"}
              value={form.project_id}
              onChange={(e) => setForm({ ...form, project_id: e.target.value })}
            >
              <option value="">없음</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  [{p.code}] {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className={label}>실제 업무시간 (h)</div>
            <input
              type="number"
              min={0}
              max={24}
              step={0.5}
              placeholder="예: 6.5"
              className={input + " mt-1 w-full"}
              value={form.hours}
              onChange={(e) => setForm({ ...form, hours: e.target.value })}
            />
          </div>
          <div>
            <div className={label}>비고</div>
            <input
              className={input + " mt-1 w-full"}
              placeholder="특이사항"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </div>
        </div>
        <textarea
          className={input + " mt-3 min-h-20 w-full resize-y"}
          placeholder="오늘 한 일을 기록하세요"
          value={form.content}
          onChange={(e) => setForm({ ...form, content: e.target.value })}
        />
        <div className="mt-2 flex gap-2">
          <button
            onClick={save}
            disabled={busy}
            className="rounded-md bg-navy px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "저장 중..." : editId ? "수정 저장" : "일지 저장"}
          </button>
          {editId && (
            <button
              onClick={() => {
                setEditId(null);
                setForm(empty);
              }}
              className="rounded-md border border-navy/15 px-4 py-2 text-sm text-navy/60 hover:text-navy"
            >
              취소
            </button>
          )}
        </div>
      </div>

      {/* 목록 */}
      <div className="flex flex-col gap-2">
        {visible.map((l) => (
          <div key={l.id} className="rounded-xl bg-card px-4 py-3 shadow-sm">
            <div className="flex items-center gap-2 text-[11px] text-navy/45">
              <span className="font-bold text-navy/70">{fmtDateW(l.work_date)}</span>
              {(isDirector || l.author_id !== meId) && (
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: colorOf(l.author_id) }} />
                  {nameOf(l.author_id)}
                </span>
              )}
              {l.project_id && (
                <span className="rounded bg-navy/8 px-1 py-px text-[9px] font-bold text-navy/55">
                  {projectOf(l.project_id)?.code ?? "?"}
                </span>
              )}
              {l.hours !== null && (
                <span className="rounded bg-gold/15 px-1.5 py-px text-[10px] font-bold text-gold">
                  {l.hours}h
                </span>
              )}
              {l.author_id === meId && (
                <span className="ml-auto flex gap-1">
                  <button
                    onClick={() => startEdit(l)}
                    className="rounded px-1.5 py-0.5 text-[11px] text-navy/40 hover:bg-navy/5 hover:text-navy"
                  >
                    수정
                  </button>
                  <button
                    onClick={() => remove(l)}
                    className="rounded px-1.5 py-0.5 text-[11px] text-navy/40 hover:text-danger"
                  >
                    삭제
                  </button>
                </span>
              )}
            </div>
            <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-navy/85">{l.content}</p>
            {l.note && <p className="mt-1 text-xs text-navy/50">비고: {l.note}</p>}
          </div>
        ))}
        {visible.length === 0 && (
          <p className="rounded-xl border border-dashed border-navy/15 px-4 py-8 text-center text-sm text-navy/35">
            {fmtMonth(month)}에 작성된 일지가 없습니다.
          </p>
        )}
      </div>
    </div>
  );
}
