"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { BoardData, BoardImage } from "./types";

/**
 * 레퍼런스 보드 — v17 다크 UX 계승.
 * 7b: 조회(마소너리·존 네비·라이트박스·doc 스트립·판정 모아보기) +
 *     회의록/방향 로그/파일 링크 읽기.
 * 편집·업로드·판정·Realtime은 다음 소단계.
 */

type ViewMode = "all" | "stars" | "verdict";

const KIND_LABEL: Record<string, { label: string; cls: string }> = {
  keep: { label: "유지", cls: "border-board-line text-board-mut" },
  add: { label: "추가", cls: "border-gold-bright/50 text-gold-bright" },
  remove: { label: "제거", cls: "border-verdict-bad/50 text-verdict-bad" },
  note: { label: "메모", cls: "border-board-line text-board-mut" },
};

const DL_STATUS: Record<string, { label: string; cls: string }> = {
  open: { label: "미확정", cls: "border-gold-bright/50 text-gold-bright" },
  confirmed: { label: "확정", cls: "border-verdict-good/50 text-verdict-good" },
  superseded: { label: "대체됨", cls: "border-board-line text-board-mut line-through" },
};

function fmtDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${y.slice(2)}.${m}.${d}`;
}

export function BoardView({
  data,
  meId,
  isDirector,
}: {
  data: BoardData;
  meId: string;
  isDirector: boolean;
}) {
  const { board, zones, images, meetings, directionLogs, assets, team } = data;

  const [mode, setMode] = useState<ViewMode>("all");
  const [lightbox, setLightbox] = useState<number | null>(null); // visibleImages index
  const [infoTab, setInfoTab] = useState<"meetings" | "logs" | "assets">("meetings");
  const [infoOpen, setInfoOpen] = useState(false);

  const nameOf = useMemo(() => {
    const m = new Map(team.map((t) => [t.id, t.name]));
    return (id: string | null) => (id ? (m.get(id) ?? "?") : "?");
  }, [team]);
  const colorOf = useMemo(() => {
    const m = new Map(team.map((t) => [t.id, t.color]));
    return (id: string | null) => (id ? (m.get(id) ?? "#8b8894") : "#8b8894");
  }, [team]);

  // 표시 이미지 (숨김 제외 — 편집 모드는 다음 단계)
  const visible = useMemo(
    () => images.filter((i) => !i.hidden && (mode !== "stars" || i.starred)),
    [images, mode],
  );
  const byZone = useMemo(() => {
    const m = new Map<string, BoardImage[]>();
    for (const i of visible) {
      const arr = m.get(i.zone_id) ?? [];
      arr.push(i);
      m.set(i.zone_id, arr);
    }
    return m;
  }, [visible]);

  // 라이트박스 내비
  const openLightbox = useCallback(
    (img: BoardImage) => {
      const idx = visible.findIndex((v) => v.id === img.id);
      if (idx >= 0) setLightbox(idx);
    },
    [visible],
  );
  useEffect(() => {
    if (lightbox === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
      if (e.key === "ArrowLeft")
        setLightbox((i) => (i === null ? null : (i + visible.length - 1) % visible.length));
      if (e.key === "ArrowRight")
        setLightbox((i) => (i === null ? null : (i + 1) % visible.length));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, visible.length]);

  const openCount = directionLogs.filter((l) => l.status === "open").length;
  const lb = lightbox !== null ? visible[lightbox] : null;
  const lbZone = lb ? zones.find((z) => z.id === lb.zone_id) : null;

  return (
    <div className="min-h-screen bg-board-bg text-board-ink">
      {/* ===== 보드 상단 바 ===== */}
      <div className="sticky top-14 z-30 border-b border-board-line bg-board-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-5 pt-3">
          <h1 className="text-[17px] font-extrabold">
            {board.projectCode && (
              <em className="not-italic text-gold-bright">{board.projectCode} </em>
            )}
            {board.title}
          </h1>
          <span className="font-mono text-xs text-board-mut">
            {board.kind === "project"
              ? "프로젝트 보드"
              : board.kind === "shared"
                ? "공용 보드"
                : `개인 수집함${board.shared ? " · 공개" : ""}`}{" "}
            · {visible.length}장
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            <PillBtn on={mode === "stars"} onClick={() => setMode(mode === "stars" ? "all" : "stars")}>
              ★ 별표만
            </PillBtn>
            <PillBtn on={mode === "verdict"} onClick={() => setMode(mode === "verdict" ? "all" : "verdict")}>
              판정 모아보기
            </PillBtn>
            <Link
              href="/boards"
              className="rounded-full border border-board-line bg-board-panel px-3.5 py-1.5 text-xs text-board-mut hover:text-board-ink"
            >
              보드 목록
            </Link>
          </div>
        </div>
        {/* 존 칩 네비 */}
        {mode !== "verdict" && (
          <nav className="mx-auto flex max-w-[1600px] gap-2 overflow-x-auto px-5 py-2.5 [scrollbar-width:none]">
            {zones.map((z, i) => (
              <a
                key={z.id}
                href={`#zone-${z.id}`}
                className="flex shrink-0 items-center gap-2 rounded-full border border-board-line bg-board-panel px-3 py-1.5 text-xs text-board-mut hover:text-board-ink"
              >
                <span className="font-mono text-[10px] text-gold-bright">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {z.title}
                <span className="font-mono text-[10px] opacity-70">
                  {(byZone.get(z.id) ?? []).length}
                </span>
              </a>
            ))}
          </nav>
        )}
      </div>

      <main className="mx-auto max-w-[1600px] px-5 pb-24">
        {/* ===== LOG 패널: 회의록 / 방향 로그 / 파일 링크 ===== */}
        <section className="mt-5 rounded-xl border border-board-line bg-board-panel px-5 pb-3 pt-4">
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="rounded border border-gold-bright/40 px-1.5 py-0.5 font-mono text-[11px] text-gold-bright">
              LOG
            </span>
            <h2 className="text-[15px] font-extrabold">차수별 회의록 · 로그</h2>
            <span className="ml-auto text-[11px] text-board-mut">
              미팅마다 유지 / 추가 / 제거를 누적 — 수정하면 이전 버전이 이력으로 남습니다
            </span>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <ITab on={infoOpen && infoTab === "meetings"} onClick={() => { setInfoTab("meetings"); setInfoOpen(true); }}>
              회의록 <span className="font-mono text-[10px] opacity-75">{meetings.length}</span>
            </ITab>
            {board.kind === "project" && (
              <ITab on={infoOpen && infoTab === "logs"} onClick={() => { setInfoTab("logs"); setInfoOpen(true); }}>
                방향 로그 <span className="font-mono text-[10px] opacity-75">{directionLogs.length}</span>
              </ITab>
            )}
            <ITab on={infoOpen && infoTab === "assets"} onClick={() => { setInfoTab("assets"); setInfoOpen(true); }}>
              파일 링크 <span className="font-mono text-[10px] opacity-75">{assets.length}</span>
            </ITab>
            <button
              onClick={() => setInfoOpen(!infoOpen)}
              className="ml-auto rounded-full border border-board-line px-3 py-1 text-[11px] text-board-mut hover:text-gold-bright"
            >
              {infoOpen ? "접기 ▴" : "펼치기 ▾"}
            </button>
          </div>

          {!infoOpen && (
            <p className="py-2.5 text-[12.5px] leading-relaxed text-board-mut">
              {meetings.length > 0 ? (
                <>
                  최근{" "}
                  <b className="text-board-ink">
                    {meetings[0].round}차 · {meetings[0].title ?? "회의"} (
                    {fmtDate(meetings[0].met_at)})
                  </b>
                  {" — "}
                  {meetings[0].items.slice(0, 3).map((it) => it.body).join(" · ")}
                </>
              ) : (
                "아직 회의록이 없습니다."
              )}
              {board.kind === "project" && openCount > 0 && (
                <span className="ml-2 rounded-full border border-gold-bright/50 px-2 py-0.5 text-[10.5px] text-gold-bright">
                  미확정 방향 {openCount}건
                </span>
              )}
            </p>
          )}

          {infoOpen && infoTab === "meetings" && (
            <div className="py-2">
              {meetings.length === 0 && (
                <p className="py-3 text-sm text-board-mut">아직 회의록이 없습니다.</p>
              )}
              {meetings.map((m) => (
                <details key={m.id} className="border-t border-board-line" open={m.round === meetings[0]?.round}>
                  <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-2.5 py-3 text-[13.5px] [&::-webkit-details-marker]:hidden">
                    <span className="font-mono text-[11px] text-gold-bright">{m.round}차</span>
                    <b>{m.title ?? "회의"}</b>
                    <span className="font-mono text-[11px] text-board-mut">{fmtDate(m.met_at)}</span>
                    <span className="text-[11px] text-board-mut">{nameOf(m.author_id)}</span>
                    {m.revisionCount > 0 && (
                      <span className="font-mono text-[9.5px] text-board-mut">수정 {m.revisionCount}회</span>
                    )}
                    {m.comments.length > 0 && (
                      <span className="rounded-full border border-board-line px-2 py-0.5 text-[10px] text-board-mut">
                        첨삭 {m.comments.length}
                      </span>
                    )}
                  </summary>
                  <div className="pb-4 pl-4">
                    {m.body && (
                      <p className="mb-2.5 text-[12.8px] leading-relaxed text-[#cfccc4]">{m.body}</p>
                    )}
                    <ul className="space-y-1.5">
                      {m.items.map((it) => {
                        const k = KIND_LABEL[it.kind] ?? KIND_LABEL.note;
                        return (
                          <li key={it.id} className="flex items-start gap-2 text-[12.8px] leading-relaxed">
                            <span className={`mt-0.5 shrink-0 rounded-full border px-2 py-px text-[10px] ${k.cls}`}>
                              {k.label}
                            </span>
                            <span className={it.kind === "remove" ? "text-[#e0b7b7]" : "text-[#cfccc4]"}>
                              {it.body}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                    {m.comments.length > 0 && (
                      <div className="mt-3 border-l-2 border-board-line pl-3">
                        {m.comments.map((c) => (
                          <div key={c.id} className="py-1 text-[12px]">
                            <span className="font-semibold" style={{ color: colorOf(c.author_id) }}>
                              {nameOf(c.author_id)}
                            </span>{" "}
                            <span className="text-[#b9b5ac]">{c.body}</span>
                            <span className="ml-2 font-mono text-[9.5px] text-board-mut">
                              {fmtDate(c.created_at)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </details>
              ))}
            </div>
          )}

          {infoOpen && infoTab === "logs" && board.kind === "project" && (
            <div className="py-2">
              {directionLogs.map((l) => {
                const s = DL_STATUS[l.status] ?? DL_STATUS.open;
                return (
                  <div key={l.id} className="flex items-start gap-2.5 border-t border-board-line py-2.5 text-[12.8px]">
                    <span className={`mt-0.5 shrink-0 rounded-full border px-2 py-px text-[10px] ${s.cls}`}>
                      {s.label}
                    </span>
                    <span className={l.status === "superseded" ? "text-board-mut line-through" : "text-[#cfccc4]"}>
                      {l.body}
                    </span>
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-board-mut">
                      {nameOf(l.author_id)} · {fmtDate(l.created_at)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {infoOpen && infoTab === "assets" && (
            <div className="py-2">
              {assets.map((a) => (
                <div key={a.id} className="flex items-center gap-2.5 border-t border-board-line py-2 text-[12.5px]">
                  <span className="font-mono text-[11.5px] text-[#cfccc4]">{a.name}</span>
                  {a.url ? (
                    <a
                      href={a.url}
                      target="_blank"
                      rel="noreferrer"
                      className="border-b border-dotted border-gold-bright/40 text-[11.5px] text-gold-bright"
                    >
                      열기 ↗
                    </a>
                  ) : (
                    <span className="text-[11px] text-board-mut/40">링크 미연결</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ===== 본문: 판정 모아보기 or 존 그리드 ===== */}
        {mode === "verdict" ? (
          <VerdictView images={images} zones={zones} nameOf={nameOf} onOpen={openLightbox} />
        ) : (
          zones.map((z, zi) => {
            const zoneImages = byZone.get(z.id) ?? [];
            // doc_group 분리
            const groups = new Map<string, BoardImage[]>();
            const singles: BoardImage[] = [];
            for (const img of zoneImages) {
              if (img.doc_group) {
                const arr = groups.get(img.doc_group) ?? [];
                arr.push(img);
                groups.set(img.doc_group, arr);
              } else singles.push(img);
            }
            return (
              <section
                key={z.id}
                id={`zone-${z.id}`}
                className="pt-9 [content-visibility:auto] [contain-intrinsic-size:auto_800px]"
              >
                <header className="mb-4 flex flex-wrap items-baseline gap-3 border-b border-board-line pb-3">
                  <span className="rounded border border-gold-bright/40 px-1.5 py-0.5 font-mono text-[12px] text-gold-bright">
                    {String(zi + 1).padStart(2, "0")}
                  </span>
                  <h2 className="text-lg font-extrabold">{z.title}</h2>
                  {z.batch_label && (
                    <span className="rounded-full border border-board-line px-2 py-0.5 font-mono text-[10.5px] text-board-mut opacity-70">
                      {z.batch_label}
                    </span>
                  )}
                  <span className="ml-auto font-mono text-xs text-board-mut">
                    {zoneImages.length}장
                  </span>
                </header>

                {/* doc_group 가로 스트립 */}
                {[...groups.entries()].map(([g, imgs]) => (
                  <div key={g} className="mb-4 rounded-xl border border-board-line bg-[#1f1f24] px-3.5 pb-2 pt-3 [column-span:all]">
                    <div className="mb-2.5 flex flex-wrap items-baseline gap-2.5 text-[13px]">
                      <span>📄</span>
                      <b>{g}</b>
                      <span className="font-mono text-[11px] text-board-mut">{imgs.length}p · 한 문서에서 추출</span>
                      <span className="ml-auto text-[10.5px] text-board-mut opacity-70">← 좌우 스크롤 →</span>
                    </div>
                    <div className="flex gap-0.5 overflow-x-auto pb-1.5 [scrollbar-width:thin]">
                      {imgs.map((img, pi) => (
                        <div key={img.id} className="relative w-[158px] shrink-0 cursor-zoom-in first:rounded-l-lg last:rounded-r-lg" onClick={() => openLightbox(img)}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img.src} alt="" loading="lazy" className="block h-auto w-full" />
                          <span className="pointer-events-none absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 font-mono text-[10px] text-white">
                            {pi + 1}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                {/* 마소너리 */}
                <div className="[column-gap:10px] [columns:5_260px]">
                  {singles.map((img) => (
                    <Card key={img.id} img={img} onOpen={openLightbox} />
                  ))}
                  {singles.length === 0 && groups.size === 0 && (
                    <p className="py-6 text-sm text-board-mut">이 구역에 이미지가 없습니다.</p>
                  )}
                </div>
              </section>
            );
          })
        )}
      </main>

      {/* ===== 라이트박스 ===== */}
      {lb && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0a0a0c]/95 p-6"
          role="dialog"
          aria-modal
          onClick={() => setLightbox(null)}
        >
          <button className="fixed right-5 top-5 h-11 w-11 rounded-full border border-board-line text-lg text-board-ink hover:border-gold-bright hover:text-gold-bright" aria-label="닫기">
            ✕
          </button>
          <button
            className="fixed left-5 top-1/2 h-11 w-11 rounded-full border border-board-line text-lg text-board-ink hover:border-gold-bright hover:text-gold-bright"
            aria-label="이전"
            onClick={(e) => {
              e.stopPropagation();
              setLightbox((i) => (i === null ? null : (i + visible.length - 1) % visible.length));
            }}
          >
            ←
          </button>
          <button
            className="fixed right-5 top-1/2 h-11 w-11 rounded-full border border-board-line text-lg text-board-ink hover:border-gold-bright hover:text-gold-bright"
            aria-label="다음"
            onClick={(e) => {
              e.stopPropagation();
              setLightbox((i) => (i === null ? null : (i + 1) % visible.length));
            }}
          >
            →
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lb.src} alt="" className="max-h-[78vh] max-w-[92vw] rounded-md" onClick={(e) => e.stopPropagation()} />
          <div className="mt-3.5 flex flex-wrap items-center justify-center gap-3.5 text-[13px] text-board-mut">
            <b className="text-board-ink">{lbZone?.title}</b>
            {lb.filename && <span className="font-mono text-[11.5px]">{lb.filename}</span>}
            {lb.starred && <span className="text-gold-bright">★ 채택 후보</span>}
            {lb.verdict && (
              <span className={lb.verdict === "good" ? "text-verdict-good" : "text-verdict-bad"}>
                {lb.verdict === "good" ? "● 좋음" : "● 나쁨"} — {nameOf(lb.verdict_by)}
              </span>
            )}
            <span className="font-mono text-[11px]">
              {(lightbox ?? 0) + 1} / {visible.length}
            </span>
          </div>
          {(lb.memo || lb.verdict_memo) && (
            <div className="mt-2 max-w-[70ch] text-center text-[13px] text-[#e8e2d2]">
              {lb.memo && <p>{lb.memo}</p>}
              {lb.verdict_memo && (
                <p className={lb.verdict === "good" ? "mt-1 text-verdict-good" : "mt-1 text-verdict-bad"}>
                  판정: {lb.verdict_memo}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function PillBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={
        "rounded-full border px-3.5 py-1.5 text-xs transition-colors " +
        (on
          ? "border-gold-bright bg-gold-bright font-bold text-board-bg"
          : "border-board-line bg-board-panel text-board-ink hover:border-[#4a4a55]")
      }
    >
      {children}
    </button>
  );
}

function ITab({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={
        "rounded-full border px-3 py-1 text-xs transition-colors " +
        (on
          ? "border-gold-bright bg-gold-bright font-bold text-board-bg"
          : "border-board-line text-board-mut hover:text-board-ink")
      }
    >
      {children}
    </button>
  );
}

function Card({ img, onOpen }: { img: BoardImage; onOpen: (i: BoardImage) => void }) {
  return (
    <figure
      className="relative mb-2.5 cursor-zoom-in overflow-hidden rounded-lg bg-board-panel [break-inside:avoid] [content-visibility:auto]"
      onClick={() => onOpen(img)}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={img.src} alt="" loading="lazy" className="block h-auto w-full hover:opacity-85" />
      {img.starred && (
        <span className="absolute left-2 top-2 text-[15px] text-gold-bright [text-shadow:0_1px_4px_#000]">★</span>
      )}
      {img.verdict && (
        <span
          className={
            "absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold text-white " +
            (img.verdict === "good" ? "bg-verdict-good" : "bg-verdict-bad")
          }
        >
          {img.verdict === "good" ? "좋음" : "나쁨"}
        </span>
      )}
      {img.memo && (
        <figcaption className="whitespace-pre-wrap border-t border-board-line bg-[#232327] px-2.5 py-2 text-xs text-[#d8d4ca]">
          {img.memo}
        </figcaption>
      )}
    </figure>
  );
}

// ---------------------------------------------------------------------------
/** 판정 모아보기 — 좋음/나쁨/미판정 그룹 + 이유 메모 (스펙 6.6 학습 뷰) */
function VerdictView({
  images,
  zones,
  nameOf,
  onOpen,
}: {
  images: BoardImage[];
  zones: BoardData["zones"];
  nameOf: (id: string | null) => string;
  onOpen: (i: BoardImage) => void;
}) {
  const zoneTitle = (id: string) => zones.find((z) => z.id === id)?.title ?? "";
  const good = images.filter((i) => !i.hidden && i.verdict === "good");
  const bad = images.filter((i) => !i.hidden && i.verdict === "bad");
  const none = images.filter((i) => !i.hidden && !i.verdict);

  const Group = ({
    title,
    tone,
    list,
    withMemo,
  }: {
    title: string;
    tone: string;
    list: BoardImage[];
    withMemo: boolean;
  }) => (
    <section className="pt-9">
      <header className="mb-4 flex items-baseline gap-3 border-b border-board-line pb-3">
        <h2 className="text-lg font-extrabold" style={{ color: tone }}>
          {title}
        </h2>
        <span className="font-mono text-xs text-board-mut">{list.length}장</span>
        {withMemo && (
          <span className="ml-auto text-[11px] text-board-mut">
            &quot;왜&quot;가 핵심 전달물 — 이유를 함께 읽으세요
          </span>
        )}
      </header>
      {withMemo ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((img) => (
            <div key={img.id} className="flex gap-3 rounded-xl border border-board-line bg-board-panel p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.src}
                alt=""
                loading="lazy"
                className="h-28 w-24 shrink-0 cursor-zoom-in rounded-md object-cover"
                onClick={() => onOpen(img)}
              />
              <div className="min-w-0 text-[12px] leading-relaxed">
                <div className="mb-1 font-mono text-[10px] text-board-mut">
                  {zoneTitle(img.zone_id)} · {nameOf(img.verdict_by)}
                </div>
                <p className="text-[#e8e2d2]">{img.verdict_memo}</p>
              </div>
            </div>
          ))}
          {list.length === 0 && <p className="text-sm text-board-mut">없음</p>}
        </div>
      ) : (
        <div className="[column-gap:10px] [columns:6_200px]">
          {list.map((img) => (
            <Card key={img.id} img={img} onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  );

  return (
    <>
      <Group title="● 좋음 — 이 프로젝트에서 통하는 것" tone="var(--color-verdict-good)" list={good} withMemo />
      <Group title="● 나쁨 — 피할 것" tone="var(--color-verdict-bad)" list={bad} withMemo />
      <Group title="미판정" tone="var(--color-board-mut)" list={none} withMemo={false} />
    </>
  );
}
