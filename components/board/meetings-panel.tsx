"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { BoardMeeting, TeamMember } from "./types";

/**
 * 차수별 회의록 패널 — 작성/편집(이력 자동 스냅샷)/첨삭/이력 열람 + Realtime.
 * 수정은 save_meeting RPC 단일 경로 (이전 버전 meeting_revisions 보존).
 */

const KIND_LABEL: Record<string, { label: string; cls: string }> = {
  keep: { label: "유지", cls: "border-board-line text-board-mut" },
  add: { label: "추가", cls: "border-gold-bright/50 text-gold-bright" },
  remove: { label: "제거", cls: "border-verdict-bad/50 text-verdict-bad" },
  note: { label: "메모", cls: "border-board-line text-board-mut" },
};
const KINDS = ["keep", "add", "remove", "note"] as const;

function fmtDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${y.slice(2)}.${m}.${d}`;
}

type Draft = {
  id: string | null; // null = 새 차수
  round: number;
  title: string;
  met_at: string;
  body: string;
  items: { kind: string; body: string }[];
};

type Revision = {
  id: number;
  snapshot: {
    title?: string | null;
    met_at?: string;
    body?: string | null;
    items?: { kind: string; body: string }[];
  };
  edited_by: string | null;
  created_at: string;
};

export function MeetingsPanel({
  boardId,
  projectId,
  initial,
  meId,
  isDirector,
  canEdit,
  team,
}: {
  boardId: string;
  projectId: string | null;
  initial: BoardMeeting[];
  meId: string;
  isDirector: boolean;
  canEdit: boolean;
  team: TeamMember[];
}) {
  const supabase = useMemo(() => createClient(), []);
  const [meetings, setMeetings] = useState<BoardMeeting[]>(initial);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [revisions, setRevisions] = useState<Record<string, Revision[]>>({});
  const [commentDraft, setCommentDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const nameOf = useCallback(
    (id: string | null) => team.find((t) => t.id === id)?.name ?? "?",
    [team],
  );
  const colorOf = useCallback(
    (id: string | null) => team.find((t) => t.id === id)?.color ?? "#8b8894",
    [team],
  );

  // ---------------------------------------------------------------------------
  const refetch = useCallback(async () => {
    const { data } = await supabase
      .from("meetings")
      .select(
        "id, round, title, met_at, body, author_id, updated_at, meeting_items(id, kind, body, sort_order), meeting_comments(id, author_id, body, resolved, created_at), meeting_revisions(id)",
      )
      .eq("board_id", boardId)
      .order("round", { ascending: false });
    setMeetings(
      (data ?? []).map((m) => ({
        id: m.id,
        round: m.round,
        title: m.title,
        met_at: m.met_at,
        body: m.body,
        author_id: m.author_id,
        updated_at: m.updated_at,
        items: (m.meeting_items ?? []).sort((a, b) => a.sort_order - b.sort_order),
        comments: (m.meeting_comments ?? []).sort((a, b) =>
          a.created_at.localeCompare(b.created_at),
        ),
        revisionCount: (m.meeting_revisions ?? []).length,
      })),
    );
  }, [supabase, boardId]);

  // Realtime — 회의록/항목/첨삭 변경 시 재조회 (RLS 준수)
  useEffect(() => {
    const ch = supabase
      .channel(`meetings-${boardId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "meetings", filter: `board_id=eq.${boardId}` },
        refetch,
      )
      .on("postgres_changes", { event: "*", schema: "public", table: "meeting_items" }, refetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "meeting_comments" }, refetch)
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [supabase, boardId, refetch]);

  function logEvent(type: string, payload: Record<string, string | number | null>) {
    supabase
      .from("events")
      .insert({ actor_id: meId, board_id: boardId, project_id: projectId, type, payload })
      .then(({ error }) => error && console.warn("이벤트 기록 실패:", error.message));
  }

  // ---------------------------------------------------------------------------
  function startNew() {
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    setDraft({
      id: null,
      round: Math.max(0, ...meetings.map((m) => m.round)) + 1,
      title: "",
      met_at: iso,
      body: "",
      items: [{ kind: "add", body: "" }],
    });
  }

  function startEdit(m: BoardMeeting) {
    setDraft({
      id: m.id,
      round: m.round,
      title: m.title ?? "",
      met_at: m.met_at,
      body: m.body ?? "",
      items: m.items.length > 0 ? m.items.map((i) => ({ kind: i.kind, body: i.body })) : [{ kind: "keep", body: "" }],
    });
  }

  async function saveDraft() {
    if (!draft) return;
    const items = draft.items.filter((i) => i.body.trim() !== "");
    setSaving(true);
    try {
      if (draft.id === null) {
        const { data: created, error } = await supabase
          .from("meetings")
          .insert({
            board_id: boardId,
            round: draft.round,
            title: draft.title.trim() || null,
            met_at: draft.met_at,
            body: draft.body.trim() || null,
            author_id: meId,
          })
          .select()
          .single();
        if (error) throw new Error(error.message);
        if (items.length > 0) {
          const { error: e2 } = await supabase.from("meeting_items").insert(
            items.map((i, k) => ({ meeting_id: created.id, kind: i.kind, body: i.body.trim(), sort_order: k })),
          );
          if (e2) throw new Error(e2.message);
        }
        logEvent("meeting.created", { meeting_id: created.id, round: draft.round, title: draft.title || null });
      } else {
        const { error } = await supabase.rpc("save_meeting", {
          p_meeting_id: draft.id,
          p_title: draft.title.trim(),
          p_met_at: draft.met_at,
          p_body: draft.body.trim(),
          p_items: items.map((i) => ({ kind: i.kind, body: i.body.trim() })),
        });
        if (error) throw new Error(error.message);
      }
      setDraft(null);
      await refetch();
    } catch (e) {
      alert("저장 실패: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function removeMeeting(m: BoardMeeting) {
    if (!window.confirm(`${m.round}차 회의록을 삭제할까요? (이력 포함 삭제)`)) return;
    const { error } = await supabase.from("meetings").delete().eq("id", m.id);
    if (error) {
      alert("삭제 실패: " + error.message);
      return;
    }
    logEvent("meeting.removed", { round: m.round, title: m.title });
    await refetch();
  }

  async function addComment(m: BoardMeeting) {
    const body = (commentDraft[m.id] ?? "").trim();
    if (!body) return;
    const { error } = await supabase
      .from("meeting_comments")
      .insert({ meeting_id: m.id, author_id: meId, body });
    if (error) {
      alert("첨삭 등록 실패: " + error.message);
      return;
    }
    setCommentDraft((p) => ({ ...p, [m.id]: "" }));
    logEvent("meeting.comment_added", { meeting_id: m.id, round: m.round });
    await refetch();
  }

  async function removeComment(meetingId: string, commentId: string) {
    const { error } = await supabase.from("meeting_comments").delete().eq("id", commentId);
    if (error) {
      alert("삭제 실패: " + error.message);
      return;
    }
    await refetch();
  }

  async function loadRevisions(m: BoardMeeting) {
    if (revisions[m.id]) {
      setRevisions((p) => {
        const next = { ...p };
        delete next[m.id];
        return next;
      });
      return;
    }
    const { data } = await supabase
      .from("meeting_revisions")
      .select("id, snapshot, edited_by, created_at")
      .eq("meeting_id", m.id)
      .order("created_at", { ascending: false });
    setRevisions((p) => ({ ...p, [m.id]: (data ?? []) as Revision[] }));
  }

  // ---------------------------------------------------------------------------
  const editorFor = (m: BoardMeeting | null) =>
    draft && ((m === null && draft.id === null) || (m !== null && draft.id === m.id));

  return (
    <div className="py-2">
      {canEdit && !draft && (
        <button
          onClick={startNew}
          className="mb-2 rounded-full border border-board-line px-3 py-1 text-[11.5px] text-board-mut hover:border-gold-bright hover:text-gold-bright"
        >
          ＋ {Math.max(0, ...meetings.map((m) => m.round)) + 1}차 회의록 작성
        </button>
      )}

      {/* 새 차수 편집기 */}
      {editorFor(null) && (
        <MeetingEditor draft={draft!} setDraft={setDraft} onSave={saveDraft} saving={saving} />
      )}

      {meetings.length === 0 && !draft && (
        <p className="py-3 text-sm text-board-mut">아직 회의록이 없습니다.</p>
      )}

      {meetings.map((m) => (
        <details key={m.id} className="border-t border-board-line" open={m.round === meetings[0]?.round || !!editorFor(m)}>
          <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-2.5 py-3 text-[13.5px] [&::-webkit-details-marker]:hidden">
            <span className="font-mono text-[11px] text-gold-bright">{m.round}차</span>
            <b>{m.title || "회의"}</b>
            <span className="font-mono text-[11px] text-board-mut">{fmtDate(m.met_at)}</span>
            <span className="text-[11px] text-board-mut">{nameOf(m.author_id)}</span>
            {m.revisionCount > 0 && (
              <button
                onClick={(e) => { e.preventDefault(); loadRevisions(m); }}
                className="rounded-full border border-board-line px-2 py-0.5 font-mono text-[9.5px] text-board-mut hover:text-gold-bright"
              >
                이력 {m.revisionCount}
              </button>
            )}
            {m.comments.length > 0 && (
              <span className="rounded-full border border-board-line px-2 py-0.5 text-[10px] text-board-mut">
                첨삭 {m.comments.length}
              </span>
            )}
            {canEdit && !draft && (
              <span className="ml-auto flex gap-1.5">
                <button
                  onClick={(e) => { e.preventDefault(); startEdit(m); }}
                  className="rounded-full border border-board-line px-2.5 py-0.5 text-[10.5px] text-board-mut hover:border-gold-bright hover:text-gold-bright"
                >
                  편집
                </button>
                {(m.author_id === meId || isDirector) && (
                  <button
                    onClick={(e) => { e.preventDefault(); removeMeeting(m); }}
                    className="rounded-full border border-board-line px-2.5 py-0.5 text-[10.5px] text-board-mut hover:border-verdict-bad hover:text-verdict-bad"
                  >
                    삭제
                  </button>
                )}
              </span>
            )}
          </summary>

          {editorFor(m) ? (
            <MeetingEditor draft={draft!} setDraft={setDraft} onSave={saveDraft} saving={saving} />
          ) : (
            <div className="pb-4 pl-4">
              {m.body && <p className="mb-2.5 text-[12.8px] leading-relaxed text-[#cfccc4]">{m.body}</p>}
              <ul className="space-y-1.5">
                {m.items.map((it) => {
                  const k = KIND_LABEL[it.kind] ?? KIND_LABEL.note;
                  return (
                    <li key={it.id} className="flex items-start gap-2 text-[12.8px] leading-relaxed">
                      <span className={`mt-0.5 shrink-0 rounded-full border px-2 py-px text-[10px] ${k.cls}`}>{k.label}</span>
                      <span className={it.kind === "remove" ? "text-[#e0b7b7]" : "text-[#cfccc4]"}>{it.body}</span>
                    </li>
                  );
                })}
              </ul>

              {/* 이력 */}
              {revisions[m.id] && (
                <div className="ml-1 mt-3 border-l-2 border-board-line pl-3">
                  <div className="mb-1 font-mono text-[10px] text-board-mut">수정 이력 (최신순)</div>
                  {revisions[m.id].map((r) => (
                    <details key={r.id} className="mb-1.5">
                      <summary className="cursor-pointer font-mono text-[10.5px] text-board-mut hover:text-gold-bright">
                        {fmtDate(r.created_at)} · {nameOf(r.edited_by)} 편집 이전 버전
                      </summary>
                      <div className="mt-1 rounded-lg bg-[#232327] px-3 py-2 text-[11.5px] leading-relaxed text-[#b9b5ac]">
                        {r.snapshot.title && <div className="font-semibold">{r.snapshot.title}</div>}
                        {r.snapshot.body && <p className="mt-0.5">{r.snapshot.body}</p>}
                        <ul className="mt-1 space-y-0.5">
                          {(r.snapshot.items ?? []).map((it, i) => (
                            <li key={i}>
                              <span className="text-board-mut">[{KIND_LABEL[it.kind]?.label ?? it.kind}]</span> {it.body}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </details>
                  ))}
                </div>
              )}

              {/* 첨삭 */}
              <div className="mt-3 border-l-2 border-board-line pl-3">
                {m.comments.map((c) => (
                  <div key={c.id} className="group flex items-baseline gap-1.5 py-1 text-[12px]">
                    <span className="font-semibold" style={{ color: colorOf(c.author_id) }}>
                      {nameOf(c.author_id)}
                    </span>
                    <span className="text-[#b9b5ac]">{c.body}</span>
                    <span className="font-mono text-[9.5px] text-board-mut">{fmtDate(c.created_at)}</span>
                    {(c.author_id === meId || isDirector) && (
                      <button
                        onClick={() => removeComment(m.id, c.id)}
                        className="invisible text-[10px] text-board-mut hover:text-verdict-bad group-hover:visible"
                        title="첨삭 삭제"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                ))}
                <div className="flex gap-1.5 py-1.5">
                  <input
                    value={commentDraft[m.id] ?? ""}
                    onChange={(e) => setCommentDraft((p) => ({ ...p, [m.id]: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && addComment(m)}
                    placeholder="첨삭 남기기 — Enter로 등록"
                    className="w-full max-w-md rounded-md border border-board-line bg-[#232327] px-2.5 py-1.5 text-[12px] text-board-ink outline-none placeholder:text-board-mut/50 focus:border-gold-bright"
                  />
                  <button
                    onClick={() => addComment(m)}
                    className="shrink-0 rounded-md border border-board-line px-3 text-[11px] text-board-mut hover:border-gold-bright hover:text-gold-bright"
                  >
                    등록
                  </button>
                </div>
              </div>
            </div>
          )}
        </details>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
function MeetingEditor({
  draft,
  setDraft,
  onSave,
  saving,
}: {
  draft: Draft;
  setDraft: (d: Draft | null) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const patch = (p: Partial<Draft>) => setDraft({ ...draft, ...p });
  const patchItem = (i: number, p: Partial<{ kind: string; body: string }>) =>
    patch({ items: draft.items.map((it, k) => (k === i ? { ...it, ...p } : it)) });

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-xl border border-gold-bright/30 bg-[#1f1f24] p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[11px] text-gold-bright">{draft.round}차</span>
        <input
          value={draft.title}
          onChange={(e) => patch({ title: e.target.value })}
          placeholder="회의 제목 (예: 2차 시안 리뷰)"
          className="min-w-56 flex-1 rounded-md border border-board-line bg-[#232327] px-2.5 py-1.5 text-[13px] text-board-ink outline-none focus:border-gold-bright"
        />
        <input
          type="date"
          value={draft.met_at}
          onChange={(e) => patch({ met_at: e.target.value })}
          className="rounded-md border border-board-line bg-[#232327] px-2.5 py-1.5 text-[12px] text-board-ink outline-none [color-scheme:dark] focus:border-gold-bright"
        />
      </div>
      <textarea
        value={draft.body}
        onChange={(e) => patch({ body: e.target.value })}
        placeholder="자유 본문 — 회의 요약, 배경, 다음 액션 등"
        className="min-h-16 resize-y rounded-md border border-board-line bg-[#232327] px-2.5 py-2 text-[12.5px] leading-relaxed text-board-ink outline-none focus:border-gold-bright"
      />
      <div className="flex flex-col gap-1.5">
        {draft.items.map((it, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <select
              value={it.kind}
              onChange={(e) => patchItem(i, { kind: e.target.value })}
              className="rounded-md border border-board-line bg-[#232327] px-1.5 py-1.5 text-[11px] text-board-ink outline-none"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k].label}
                </option>
              ))}
            </select>
            <input
              value={it.body}
              onChange={(e) => patchItem(i, { body: e.target.value })}
              placeholder="항목 내용"
              className="flex-1 rounded-md border border-board-line bg-[#232327] px-2.5 py-1.5 text-[12.5px] text-board-ink outline-none focus:border-gold-bright"
            />
            <button
              onClick={() => patch({ items: draft.items.filter((_, k) => k !== i) })}
              className="shrink-0 text-[12px] text-board-mut hover:text-verdict-bad"
              title="항목 삭제"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          onClick={() => patch({ items: [...draft.items, { kind: "add", body: "" }] })}
          className="self-start rounded-full border border-board-line px-2.5 py-0.5 text-[10.5px] text-board-mut hover:border-gold-bright hover:text-gold-bright"
        >
          ＋ 항목
        </button>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onSave}
          disabled={saving}
          className="rounded-full border border-gold-bright bg-gold-bright px-4 py-1.5 text-[12px] font-bold text-board-bg disabled:opacity-50"
        >
          {saving ? "저장 중..." : draft.id ? "저장 (이전 버전 이력 보존)" : "회의록 등록"}
        </button>
        <button
          onClick={() => setDraft(null)}
          className="rounded-full border border-board-line px-4 py-1.5 text-[12px] text-board-mut hover:text-board-ink"
        >
          취소
        </button>
      </div>
    </div>
  );
}
