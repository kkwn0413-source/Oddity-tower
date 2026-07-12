"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ASPECTS, type Mark, type MemoGroup, type Annotation } from "@/lib/triage";

/**
 * 레퍼런스 정리(트리아지) 카드 흐름 — 목업 정본 reference/triage-mockup-v2.html 이식.
 * 데스크톱·모바일 통합(Pointer Events). 존 기본값 = 업로드된 zone_id.
 * AI 추정 줄은 ai_zone_guess가 있을 때만(대량 덤프 비전 보조) 표시.
 */

type Zone = { id: string; title: string; kind: string; sort_order: number };
type Img = {
  id: string;
  zone_id: string;
  src: string;
  source_filename: string | null;
  ai_zone_guess: string | null;
  ai_aspect_guess: string | null;
  aspect: string | null;
  annotation: Annotation | null;
  doc_group: string | null;
};
type Processed = {
  discard: boolean;
  zoneId: string | null;
  marks: number;
  memos: number;
};

// 도장 목업 팔레트
const SEAL = "#C43A2F";

export function TriageFlow({
  boardId,
  boardTitle,
  zones: initialZones,
  images,
  meId,
}: {
  boardId: string;
  boardTitle: string;
  zones: Zone[];
  images: Img[];
  meId: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const total = images.length;

  const [zones, setZones] = useState<Zone[]>(initialZones);
  const [idx, setIdx] = useState(0);
  const [done, setDone] = useState(false);
  const [results, setResults] = useState<Processed[]>([]);

  // 카드 상태
  const [shape, setShape] = useState<"ellipse" | "rect">("ellipse");
  const [armed, setArmed] = useState(true);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [groups, setGroups] = useState<MemoGroup[]>([]);
  const [mergeSource, setMergeSource] = useState<number | null>(null);
  const [selectedZone, setSelectedZone] = useState<string>("");
  const [selectedAspect, setSelectedAspect] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [saving, setSaving] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const marksRef = useRef<Mark[]>([]);
  const dragRef = useRef<{ a: XY; b: XY } | null>(null);

  const cur = images[idx];

  // 카드 전환 시 상태 초기화 (render 중 조정 — effect setState 회피).
  // marksRef는 아래 effect가 marks 상태 변경 후 동기화하므로 여기서 건드리지 않음.
  const [prevIdx, setPrevIdx] = useState(-1);
  if (prevIdx !== idx && cur) {
    setPrevIdx(idx);
    setMarks(cur.annotation?.marks ?? []);
    setGroups(cur.annotation?.memo_groups ?? []);
    setMergeSource(null);
    setSelectedZone(cur.zone_id);
    setSelectedAspect(cur.aspect ?? cur.ai_aspect_guess ?? null);
    setAdding(false);
    setNewLabel("");
  }

  const nextGid = (gs: MemoGroup[]) => Math.max(0, ...gs.map((g) => g.id)) + 1;

  // ---- 캔버스 그리기 ----
  const paint = useCallback((temp?: Omit<Mark, "n">) => {
    const cv = canvasRef.current;
    const box = boxRef.current;
    if (!cv || !box) return;
    cv.width = box.clientWidth;
    cv.height = box.clientHeight;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, cv.width, cv.height);
    const all: (Mark & { tmp?: boolean })[] = [...marksRef.current];
    if (temp) all.push({ ...temp, n: 0, tmp: true });
    for (const s of all) {
      const x = s.x0 * cv.width;
      const y = s.y0 * cv.height;
      const w = (s.x1 - s.x0) * cv.width;
      const h = (s.y1 - s.y0) * cv.height;
      ctx.strokeStyle = SEAL;
      ctx.lineWidth = 3;
      ctx.setLineDash(s.tmp ? [6, 5] : []);
      ctx.beginPath();
      if (s.shape === "ellipse")
        ctx.ellipse(x + w / 2, y + h / 2, Math.abs(w / 2), Math.abs(h / 2), 0, 0, Math.PI * 2);
      else ctx.rect(x, y, w, h);
      ctx.stroke();
      ctx.setLineDash([]);
      if (!s.tmp) {
        ctx.fillStyle = SEAL;
        ctx.beginPath();
        ctx.arc(x + 4, y + 4, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.font = "700 12px Pretendard, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(s.n), x + 4, y + 4.5);
      }
    }
  }, []);

  useEffect(() => {
    marksRef.current = marks;
    paint();
  }, [marks, paint]);

  useEffect(() => {
    const onResize = () => paint();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [paint]);

  // ---- 포인터 (마우스·터치 통합) ----
  function pos(e: React.PointerEvent): XY {
    const cv = canvasRef.current!;
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  }
  function down(e: React.PointerEvent) {
    if (!armed) return;
    try {
      canvasRef.current?.setPointerCapture(e.pointerId);
    } catch {
      // 일부 환경/합성 포인터에서 InvalidPointerId — 캡처 없이도 그리기 진행
    }
    dragRef.current = { a: pos(e), b: pos(e) };
  }
  function move(e: React.PointerEvent) {
    const d = dragRef.current;
    if (!d) return;
    d.b = pos(e);
    paint(norm(d.a, d.b, shape));
  }
  function up() {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (Math.abs(d.a.x - d.b.x) < 0.03 && Math.abs(d.a.y - d.b.y) < 0.03) {
      paint();
      return;
    }
    const n = marksRef.current.length + 1;
    const next = [...marksRef.current, { n, ...norm(d.a, d.b, shape) }];
    marksRef.current = next;
    setMarks(next);
    setGroups((g) => [...g, { id: nextGid(g), memo: "", members: [n] }]);
  }

  // ---- 메모 그룹 편집 ----
  function deleteMark(groupIdx: number) {
    const g = groups[groupIdx];
    const removed = new Set(g.members);
    const remaining = marksRef.current.filter((m) => !removed.has(m.n));
    const oldToNew = new Map<number, number>();
    const renum = remaining.map((m, i) => {
      oldToNew.set(m.n, i + 1);
      return { ...m, n: i + 1 };
    });
    marksRef.current = renum;
    setMarks(renum);
    setGroups(
      groups
        .filter((_, i) => i !== groupIdx)
        .map((gr) => ({
          ...gr,
          members: gr.members.map((x) => oldToNew.get(x)).filter((x): x is number => !!x),
        })),
    );
    setMergeSource(null);
  }
  function splitBadge(groupId: number, n: number) {
    setGroups((gs) => {
      const g = gs.find((x) => x.id === groupId);
      if (!g || g.members.length < 2) return gs;
      return [
        ...gs.map((x) =>
          x.id === groupId ? { ...x, members: x.members.filter((m) => m !== n) } : x,
        ),
        { id: nextGid(gs), memo: g.memo, members: [n] },
      ];
    });
  }
  function mergeInto(targetId: number) {
    if (mergeSource === null || targetId === mergeSource) return;
    setGroups((gs) => {
      const src = gs.find((x) => x.id === mergeSource);
      if (!src) return gs;
      return gs
        .filter((x) => x.id !== mergeSource)
        .map((x) =>
          x.id === targetId
            ? {
                ...x,
                members: [...x.members, ...src.members],
                memo: x.memo || src.memo,
              }
            : x,
        );
    });
    setMergeSource(null);
  }

  // ---- 존 직접 입력 ----
  async function commitNewZone() {
    const title = newLabel.trim();
    setAdding(false);
    setNewLabel("");
    if (!title || zones.some((z) => z.title === title)) {
      if (title) setSelectedZone(zones.find((z) => z.title === title)!.id);
      return;
    }
    const { data, error } = await supabase
      .from("ref_zones")
      .insert({
        board_id: boardId,
        title,
        kind: "object",
        sort_order: Math.max(0, ...zones.map((z) => z.sort_order)) + 1,
      })
      .select()
      .single();
    if (error) {
      alert("구역 추가 실패: " + error.message);
      return;
    }
    setZones((z) => [...z, data]);
    setSelectedZone(data.id);
  }

  // ---- 확정 / 제외 ----
  async function commit(discard: boolean) {
    if (!cur) return;
    setSaving(true);
    const memoGroups = groups.filter((g) => g.members.length > 0);
    const annotation: Annotation | null =
      marks.length > 0 ? { marks, memo_groups: memoGroups } : null;
    const patch = discard
      ? {
          triage_status: "discarded",
          triaged_by: meId,
          triaged_at: new Date().toISOString(),
        }
      : {
          zone_id: selectedZone,
          aspect: selectedAspect,
          annotation,
          triage_status: "confirmed",
          triaged_by: meId,
          triaged_at: new Date().toISOString(),
        };
    const { error } = await supabase.from("ref_images").update(patch).eq("id", cur.id);
    setSaving(false);
    if (error) {
      alert("저장 실패: " + error.message);
      return;
    }
    setResults((r) => [
      ...r,
      {
        discard,
        zoneId: discard ? null : selectedZone,
        marks: marks.length,
        memos: groups.filter((g) => g.memo.trim()).length,
      },
    ]);
    if (idx + 1 >= total) setDone(true);
    else setIdx(idx + 1);
  }

  // ---- 빈 상태 ----
  if (total === 0) {
    return (
      <Shell boardId={boardId}>
        <div className="rounded-2xl border border-[#E3E0D8] bg-white p-10 text-center">
          <p className="text-[15px] font-bold text-[#1A1F2E]">정리할 레퍼런스가 없어요</p>
          <p className="mt-1.5 text-[13px] text-[#4A5063]">
            보드에 이미지를 올리면 여기서 참고 부분을 표시하고 정리할 수 있습니다.
          </p>
          <Link
            href={`/boards/${boardId}`}
            className="mt-4 inline-block rounded-xl bg-[#1A1F2E] px-5 py-2.5 text-sm font-bold text-white"
          >
            보드로 가기
          </Link>
        </div>
      </Shell>
    );
  }

  // ---- 요약 ----
  if (done) {
    const confirmed = results.filter((r) => !r.discard);
    const byZone = new Map<string, { n: number; marks: number; memos: number }>();
    for (const r of confirmed) {
      if (!r.zoneId) continue;
      const cur = byZone.get(r.zoneId) ?? { n: 0, marks: 0, memos: 0 };
      cur.n += 1;
      cur.marks += r.marks;
      cur.memos += r.memos;
      byZone.set(r.zoneId, cur);
    }
    return (
      <Shell boardId={boardId}>
        <h1 className="font-[Noto_Serif_KR,serif] text-[19px] font-extrabold text-[#1A1F2E]">
          정리 끝났어요
        </h1>
        <p className="mb-3 text-[12.5px] text-[#4A5063]">
          {total}장 중 {confirmed.length}장 사용 · {results.length - confirmed.length}장 제외 ·
          표시 {confirmed.reduce((s, r) => s + r.marks, 0)}곳
        </p>
        <div className="rounded-[18px] border border-[#E3E0D8] bg-white p-5">
          <h3 className="mb-2.5 font-[Noto_Serif_KR,serif] text-[16px] font-extrabold">
            정리 결과
          </h3>
          {[...byZone.entries()].map(([zid, agg]) => {
            const z = zones.find((x) => x.id === zid);
            return (
              <div
                key={zid}
                className="flex items-center justify-between border-b border-[#E3E0D8] py-2.5 text-[13.5px] last:border-none"
              >
                <span>
                  <b className="font-extrabold">{z?.title ?? "?"}</b>
                  <span className="ml-1.5 text-[12px] text-[#8B8F9C]">
                    — 표시 {agg.marks}곳 · 메모 {agg.memos}건
                  </span>
                </span>
                <span className="font-extrabold" style={{ color: SEAL }}>
                  {agg.n}장
                </span>
              </div>
            );
          })}
          {byZone.size === 0 && (
            <p className="py-2 text-[13px] text-[#8B8F9C]">사용으로 확정된 이미지가 없습니다.</p>
          )}
        </div>
        <Link
          href={`/boards/${boardId}`}
          className="mt-3 block rounded-xl py-3.5 text-center text-[14.5px] font-extrabold text-white"
          style={{ background: SEAL }}
        >
          정리된 보드 보기
        </Link>
      </Shell>
    );
  }

  // ---- 카드 ----
  const spaceZones = zones.filter((z) => z.kind !== "object");
  const objectZones = zones.filter((z) => z.kind === "object");
  const orderedZones = [...spaceZones, ...objectZones];

  return (
    <Shell boardId={boardId}>
      {/* 진행 */}
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[13px] font-bold text-[#1A1F2E]">
          {boardTitle} · 레퍼런스 정리
        </span>
        <span className="font-mono text-[12.5px] text-[#8B8F9C]">
          {idx + 1} / {total}
        </span>
      </div>
      <div className="mb-3.5 h-1 overflow-hidden rounded-full bg-[#EBE8E0]">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${((idx + 1) / total) * 100}%`, background: SEAL }}
        />
      </div>
      <h1 className="font-[Noto_Serif_KR,serif] text-[18px] font-extrabold text-[#1A1F2E]">
        참고할 부분을 표시해주세요
      </h1>
      <p className="mb-3 text-[12.5px] text-[#4A5063]">
        여러 곳 표시 가능 — 표시마다 <b style={{ color: SEAL }}>번호</b>가 생기고, 번호별로 메모를
        남길 수 있어요. 표시는 선택이에요(안 하면 전체 참고).
      </p>

      <div className="overflow-hidden rounded-[20px] border border-[#E3E0D8] bg-white shadow-[0_14px_34px_rgba(26,31,46,.10)]">
        {/* 툴바 */}
        <div className="flex flex-wrap items-center gap-2 border-b border-[#E3E0D8] p-2.5">
          <div className="flex rounded-[10px] bg-[#F1EEE6] p-0.5">
            {(["ellipse", "rect"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setShape(s)}
                className={
                  "rounded-lg px-3 py-1.5 text-[12.5px] font-bold " +
                  (shape === s ? "bg-[#1A1F2E] text-white" : "text-[#4A5063]")
                }
              >
                {s === "ellipse" ? "◯ 동그라미" : "▢ 네모"}
              </button>
            ))}
          </div>
          <button
            onClick={() => setArmed((a) => !a)}
            className={
              "ml-auto rounded-[10px] px-3 py-1.5 text-[12.5px] font-bold " +
              (armed ? "text-white" : "bg-[#F1EEE6] text-[#4A5063]")
            }
            style={armed ? { background: SEAL } : undefined}
          >
            {armed ? "✏️ 그리기 켜짐" : "✋ 스크롤 모드"}
          </button>
          <div className="w-full text-[11px] text-[#8B8F9C]">
            {armed
              ? "드래그해서 표시하세요 · 그리기를 끄면 화면을 자유롭게 스크롤할 수 있어요"
              : "스크롤 모드 — 표시하려면 그리기를 켜세요"}
          </div>
        </div>

        {/* 이미지 + 캔버스 */}
        <div
          ref={boxRef}
          className="relative h-[300px] select-none bg-[#f4f2ec] sm:h-[360px]"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={cur.src}
            alt=""
            className="absolute inset-0 h-full w-full object-contain"
            draggable={false}
          />
          <canvas
            ref={canvasRef}
            onPointerDown={down}
            onPointerMove={move}
            onPointerUp={up}
            className="absolute inset-0 h-full w-full"
            style={{
              touchAction: armed ? "none" : "auto",
              pointerEvents: armed ? "auto" : "none",
              cursor: armed ? "crosshair" : "default",
            }}
          />
          {cur.source_filename && (
            <span className="pointer-events-none absolute left-3 top-2.5 rounded-full bg-[#1A1F2E]/75 px-2.5 py-1 text-[11px] text-white">
              {cur.source_filename}
            </span>
          )}
        </div>

        <div className="p-4">
          {cur.ai_zone_guess && (
            <div className="mb-2.5 flex items-center gap-2 text-[12.5px] text-[#4A5063]">
              <span className="rounded-full bg-[#1A1F2E] px-2 py-0.5 text-[10.5px] font-extrabold text-white">
                AI 추정
              </span>
              <span>
                <b>{cur.ai_zone_guess}</b>
                {cur.ai_aspect_guess ? ` · ${cur.ai_aspect_guess}` : ""}
              </span>
            </div>
          )}

          {/* 표시별 메모 */}
          <RowLabel>
            표시한 부분 메모 <small>같은 메모끼리는 &quot;묶기&quot;로 합쳐요</small>
          </RowLabel>
          {mergeSource !== null && (
            <div
              className="mb-2 rounded-[10px] px-3 py-2 text-[12px] font-bold"
              style={{ background: "#F6E5E2", color: SEAL }}
            >
              합칠 메모를 선택하세요 — 취소하려면 다시 &quot;취소&quot;를 누르세요
            </div>
          )}
          {groups.length === 0 ? (
            <div className="rounded-xl border-[1.5px] border-dashed border-[#E3E0D8] p-3 text-center text-[12px] text-[#8B8F9C]">
              아직 표시가 없어요 — 이미지 전체 참고로 처리됩니다
            </div>
          ) : (
            groups.map((g, gi) => {
              const isSource = mergeSource === g.id;
              const isTarget = mergeSource !== null && !isSource;
              return (
                <div
                  key={g.id}
                  onClick={() => isTarget && mergeInto(g.id)}
                  className={
                    "mb-2 rounded-xl border-[1.5px] p-2.5 transition-colors " +
                    (isSource
                      ? "border-[#1A1F2E] bg-[#F7F6F2]"
                      : isTarget
                        ? "cursor-pointer border-[#C43A2F] bg-[#F6E5E2]"
                        : "border-[#E3E0D8]")
                  }
                >
                  <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                    {[...g.members].sort((a, b) => a - b).map((n) => (
                      <button
                        key={n}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (mergeSource === null) splitBadge(g.id, n);
                        }}
                        title="누르면 이 번호를 묶음에서 분리"
                        className="inline-flex h-[22px] w-[22px] items-center justify-center rounded-full text-[11.5px] font-extrabold text-white"
                        style={{ background: SEAL }}
                      >
                        {n}
                      </button>
                    ))}
                    {g.members.length > 1 && (
                      <span className="text-[11px] text-[#8B8F9C]">같은 메모</span>
                    )}
                    {groups.length > 1 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setMergeSource(isSource ? null : g.id);
                        }}
                        className="ml-auto rounded-full border-[1.5px] border-[#E3E0D8] bg-white px-2.5 py-0.5 text-[11px] font-bold text-[#4A5063]"
                      >
                        {isSource ? "취소" : "🔗 묶기"}
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteMark(gi);
                      }}
                      title="이 표시 삭제"
                      className={
                        "text-[14px] leading-none text-[#8B8F9C] " +
                        (groups.length > 1 ? "" : "ml-auto")
                      }
                    >
                      ×
                    </button>
                  </div>
                  <input
                    value={g.memo}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      setGroups((gs) =>
                        gs.map((x) => (x.id === g.id ? { ...x, memo: e.target.value } : x)),
                      )
                    }
                    disabled={isTarget}
                    placeholder="이 부분에 대한 메모 (예: 이 질감으로)"
                    className="w-full border-b-[1.5px] border-[#E3E0D8] bg-transparent px-0.5 py-1.5 text-[13.5px] outline-none focus:border-[#C43A2F]"
                  />
                </div>
              );
            })
          )}

          {/* 공간·기물 */}
          <RowLabel>
            공간 · 기물 <small>업로드된 구역이 기본 — 바꾸려면 선택, 없으면 직접 입력</small>
          </RowLabel>
          <div className="flex flex-wrap gap-1.5">
            {orderedZones.map((z) => (
              <Chip
                key={z.id}
                on={selectedZone === z.id}
                onClick={() => setSelectedZone(z.id)}
              >
                {z.title}
                {z.kind === "object" ? " ·물" : ""}
              </Chip>
            ))}
            {adding ? (
              <input
                autoFocus
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitNewZone();
                  if (e.key === "Escape") {
                    setAdding(false);
                    setNewLabel("");
                  }
                }}
                onBlur={commitNewZone}
                placeholder="예: 시계탑"
                className="w-28 rounded-full border-[1.5px] px-3 py-1.5 text-[12.5px] font-semibold outline-none"
                style={{ borderColor: SEAL }}
              />
            ) : (
              <button
                onClick={() => setAdding(true)}
                className="rounded-full border-[1.5px] border-dashed border-[#E3E0D8] px-3 py-1.5 text-[12.5px] font-semibold text-[#8B8F9C]"
              >
                ＋ 직접 입력
              </button>
            )}
          </div>

          {/* 참고 요소 */}
          <RowLabel>뭘 보라는 건가요?</RowLabel>
          <div className="flex flex-wrap gap-1.5">
            {ASPECTS.map((a) => (
              <Chip
                key={a}
                on={selectedAspect === a}
                onClick={() => setSelectedAspect(selectedAspect === a ? null : a)}
              >
                {a}
              </Chip>
            ))}
          </div>

          {/* 액션 */}
          <div className="mt-4 grid grid-cols-[96px_1fr] gap-2.5">
            <button
              onClick={() => commit(true)}
              disabled={saving}
              className="rounded-[13px] border-[1.5px] border-[#E3E0D8] bg-white py-3 text-[13px] font-bold text-[#8B8F9C] disabled:opacity-50"
            >
              안 써요
            </button>
            <button
              onClick={() => commit(false)}
              disabled={saving}
              className="rounded-[13px] bg-[#1A1F2E] py-3 text-[14.5px] font-extrabold text-white disabled:opacity-50"
            >
              {saving ? "저장 중..." : "이대로 확정"}
            </button>
          </div>
        </div>
      </div>
      <p className="mt-3 text-center text-[11.5px] text-[#8B8F9C]">
        번호 뱃지를 누르면 묶음에서 분리 · 데스크톱은 마우스, 모바일은 손가락 — 같은 동작
      </p>
    </Shell>
  );
}

type XY = { x: number; y: number };
function norm(a: XY, b: XY, shape: "ellipse" | "rect"): Omit<Mark, "n"> {
  return {
    shape,
    x0: Math.min(a.x, b.x),
    y0: Math.min(a.y, b.y),
    x1: Math.max(a.x, b.x),
    y1: Math.max(a.y, b.y),
  };
}

function Shell({ boardId, children }: { boardId: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[#FAF8F3] px-4 py-7 text-[#1A1F2E]">
      <div className="mx-auto w-full max-w-[560px]">
        <div className="mb-2 flex justify-end">
          <Link href={`/boards/${boardId}`} className="text-[12px] text-[#8B8F9C] hover:text-[#1A1F2E]">
            보드로 나가기 →
          </Link>
        </div>
        {children}
      </div>
    </div>
  );
}

function RowLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1.5 mt-2.5 text-[11px] font-extrabold tracking-[0.1em] text-[#8B8F9C] [&_small]:ml-1.5 [&_small]:font-semibold [&_small]:tracking-normal [&_small]:text-[#B0B4BE]">
      {children}
    </div>
  );
}

function Chip({
  on,
  onClick,
  children,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "rounded-full border-[1.5px] px-3 py-1.5 text-[12.5px] font-semibold " +
        (on
          ? "border-[#C43A2F] bg-[#F6E5E2] font-extrabold text-[#C43A2F]"
          : "border-[#E3E0D8] bg-white text-[#4A5063]")
      }
    >
      {children}
    </button>
  );
}
