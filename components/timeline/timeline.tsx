"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  addDays,
  ddayLabel,
  diffDays,
  fmtMD,
  fmtMDW,
  isImminent,
  isWeekend,
  mondayOf,
  parseDate,
  today,
  WEEKDAYS_KO,
} from "@/lib/dates";
import type { TimelineData, TLTask } from "./types";

// ---------------------------------------------------------------------------
// 상수 — 스펙 6.1
// ---------------------------------------------------------------------------
const LEFT_W = 236; // 좌측 sticky 컬럼
const ZOOMS = { day: 44, week: 20, month: 10 } as const;
type Zoom = keyof typeof ZOOMS;
type Axis = "project" | "person";

const ROW_H = { client: 34, project: 34, task: 38, person: 34 } as const;

// ---------------------------------------------------------------------------
// 행 모델 — 프로젝트별/인원별 축 전환은 "같은 데이터, 그룹핑만 다르게"
// ---------------------------------------------------------------------------
type Row =
  | { kind: "client"; id: string; label: string; count: number }
  | {
      kind: "project";
      id: string;
      label: string;
      code: string;
      collapsed: boolean;
      milestones: { id: string; label: string; due: Date }[];
      extent: { start: Date; end: Date } | null;
    }
  | { kind: "person"; id: string; label: string; color: string; count: number }
  | { kind: "task"; task: TLTask; color: string; assigneeName: string; projectLabel?: string };

export function Timeline({
  data,
  isDirector,
}: {
  data: TimelineData;
  isDirector: boolean;
}) {
  const [zoom, setZoom] = useState<Zoom>("day");
  const [axis, setAxis] = useState<Axis>("project");
  const [workerFilter, setWorkerFilter] = useState<string | null>(null);
  const [clientFilter, setClientFilter] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const base = today();
  const dayW = ZOOMS[zoom];

  const profileById = useMemo(
    () => new Map(data.profiles.map((p) => [p.id, p])),
    [data.profiles],
  );
  const projectById = useMemo(
    () => new Map(data.projects.map((p) => [p.id, p])),
    [data.projects],
  );

  // 필터 적용된 태스크
  const tasks = useMemo(() => {
    return data.tasks.filter((t) => {
      if (workerFilter && t.assignee_id !== workerFilter) return false;
      if (clientFilter) {
        const proj = projectById.get(t.project_id);
        if (!proj || proj.client_id !== clientFilter) return false;
      }
      return true;
    });
  }, [data.tasks, workerFilter, clientFilter, projectById]);

  // 표시 범위: 데이터 경계 ±패딩, 최소 8주
  const range = useMemo(() => {
    const dates: Date[] = [base];
    for (const t of data.tasks) {
      dates.push(parseDate(t.start_date), parseDate(t.end_date));
    }
    for (const m of data.milestones) dates.push(parseDate(m.due_date));
    let start = new Date(Math.min(...dates.map((d) => d.getTime())));
    let end = new Date(Math.max(...dates.map((d) => d.getTime())));
    start = mondayOf(addDays(start, -7));
    end = addDays(end, 14);
    if (diffDays(start, end) < 56) end = addDays(start, 56);
    return { start, end, days: diffDays(start, end) + 1 };
  }, [data.tasks, data.milestones, base]);

  const x = (d: Date) => diffDays(range.start, d) * dayW;
  const bodyW = range.days * dayW;

  // -------------------------------------------------------------------------
  // 행 구성
  // -------------------------------------------------------------------------
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    if (axis === "project") {
      for (const client of data.clients) {
        if (clientFilter && client.id !== clientFilter) continue;
        const projs = data.projects.filter((p) => p.client_id === client.id);
        const clientTasks = tasks.filter((t) =>
          projs.some((p) => p.id === t.project_id),
        );
        if (projs.length === 0) continue;
        if (workerFilter && clientTasks.length === 0) continue;
        out.push({
          kind: "client",
          id: client.id,
          label: client.name,
          count: clientTasks.length,
        });
        for (const proj of projs) {
          const pTasks = tasks
            .filter((t) => t.project_id === proj.id)
            .sort((a, b) => a.sort_order - b.sort_order);
          if (workerFilter && pTasks.length === 0) continue;
          const ms = data.milestones
            .filter((m) => m.project_id === proj.id)
            .map((m) => ({ id: m.id, label: m.label, due: parseDate(m.due_date) }));
          const allT = data.tasks.filter((t) => t.project_id === proj.id);
          const extent =
            allT.length > 0
              ? {
                  start: new Date(
                    Math.min(...allT.map((t) => parseDate(t.start_date).getTime())),
                  ),
                  end: new Date(
                    Math.max(...allT.map((t) => parseDate(t.end_date).getTime())),
                  ),
                }
              : null;
          const isCollapsed = collapsed.has(proj.id);
          out.push({
            kind: "project",
            id: proj.id,
            label: proj.name,
            code: proj.code,
            collapsed: isCollapsed,
            milestones: ms,
            extent,
          });
          if (!isCollapsed) {
            for (const t of pTasks) {
              const prof = t.assignee_id ? profileById.get(t.assignee_id) : null;
              out.push({
                kind: "task",
                task: t,
                color: prof?.color ?? "#9B9B9B",
                assigneeName: prof?.name ?? "미배정",
              });
            }
          }
        }
      }
    } else {
      // 인원별: 작업자 → 배정 태스크 (프로젝트 라벨 표기)
      const people = [...data.profiles].sort((a, b) =>
        a.role === b.role ? a.name.localeCompare(b.name) : a.role === "director" ? -1 : 1,
      );
      for (const person of people) {
        if (workerFilter && person.id !== workerFilter) continue;
        const pTasks = tasks
          .filter((t) => t.assignee_id === person.id)
          .sort((a, b) => a.start_date.localeCompare(b.start_date));
        if (pTasks.length === 0) continue;
        out.push({
          kind: "person",
          id: person.id,
          label: person.name,
          color: person.color,
          count: pTasks.filter((t) => t.status !== "done").length,
        });
        for (const t of pTasks) {
          const proj = projectById.get(t.project_id);
          out.push({
            kind: "task",
            task: t,
            color: person.color,
            assigneeName: person.name,
            projectLabel: proj?.code ?? "?",
          });
        }
      }
    }
    return out;
  }, [axis, data, tasks, collapsed, workerFilter, clientFilter, profileById, projectById]);

  // -------------------------------------------------------------------------
  // 메타 스탯 + TODAY 스트립 (캠퍼스 캘린더 가시성 레이어)
  // -------------------------------------------------------------------------
  const stats = useMemo(() => {
    const active = tasks.filter((t) => t.status === "active").length;
    const wait = tasks.filter((t) => t.status === "wait").length;
    const imminent = tasks.filter((t) =>
      isImminent(t.end_date, t.status, base),
    ).length;
    return { active, wait, imminent, total: tasks.length };
  }, [tasks, base]);

  const todayCards = useMemo(() => {
    const cards: { task: TLTask; kind: "live" | "imminent"; dday: string }[] = [];
    for (const t of tasks) {
      const s = parseDate(t.start_date);
      const e = parseDate(t.end_date);
      const imminent = isImminent(t.end_date, t.status, base);
      if (imminent) {
        cards.push({ task: t, kind: "imminent", dday: ddayLabel(e, base) });
      } else if (t.status === "active" && s <= base && base <= e) {
        cards.push({ task: t, kind: "live", dday: "" });
      }
    }
    // 마감 임박 먼저, 이후 진행 중
    return cards
      .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "imminent" ? -1 : 1))
      .slice(0, 6);
  }, [tasks, base]);

  // -------------------------------------------------------------------------
  // 시간 헤더 라벨
  // -------------------------------------------------------------------------
  const headerCells = useMemo(() => {
    const months: { label: string; left: number; width: number }[] = [];
    const subs: { label: string; left: number; muted: boolean }[] = [];
    let cursor = new Date(range.start);
    let monthStart = new Date(range.start);
    while (cursor <= range.end) {
      const next = addDays(cursor, 1);
      const monthEnded = next.getMonth() !== cursor.getMonth() || next > range.end;
      if (monthEnded) {
        months.push({
          label: `${cursor.getFullYear()}년 ${cursor.getMonth() + 1}월`,
          left: x(monthStart),
          width: x(cursor) - x(monthStart) + dayW,
        });
        monthStart = next;
      }
      if (zoom === "day") {
        subs.push({
          label: `${cursor.getDate()} ${WEEKDAYS_KO[cursor.getDay()]}`,
          left: x(cursor),
          muted: isWeekend(cursor),
        });
      } else if (zoom === "week" && cursor.getDay() === 1) {
        subs.push({ label: fmtMD(cursor), left: x(cursor), muted: false });
      } else if (zoom === "month" && cursor.getDate() === 1) {
        subs.push({ label: fmtMD(cursor), left: x(cursor), muted: false });
      }
      cursor = next;
    }
    return { months, subs };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, zoom, dayW]);

  const gridLines = useMemo(() => {
    const lines: { left: number; strong: boolean }[] = [];
    let cursor = new Date(range.start);
    while (cursor <= range.end) {
      const monthLine = cursor.getDate() === 1;
      if (zoom === "day") lines.push({ left: x(cursor), strong: monthLine });
      else if (zoom === "week" && (cursor.getDay() === 1 || monthLine))
        lines.push({ left: x(cursor), strong: monthLine });
      else if (zoom === "month" && monthLine)
        lines.push({ left: x(cursor), strong: true });
      cursor = addDays(cursor, 1);
    }
    return lines;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, zoom, dayW]);

  const weekendBands = useMemo(() => {
    if (zoom !== "day") return [];
    const bands: number[] = [];
    let cursor = new Date(range.start);
    while (cursor <= range.end) {
      if (isWeekend(cursor)) bands.push(x(cursor));
      cursor = addDays(cursor, 1);
    }
    return bands;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range, zoom, dayW]);

  const totalRowsH = rows.reduce((acc, r) => acc + ROW_H[r.kind], 0);
  const todayX = x(base) + dayW / 2;

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // -------------------------------------------------------------------------
  return (
    <div className="flex flex-col gap-4">
      {/* ===== 메타 바: 기간 + 스탯 (덱 슬라이드 01 meta-bar) ===== */}
      <div className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div className="flex items-baseline gap-3">
          <span className="text-2xl font-bold tracking-tight text-navy">
            {base.getFullYear()}
          </span>
          <span className="text-lg font-semibold text-navy">타임라인</span>
          <span className="text-sm text-navy/40">
            {fmtMD(range.start)} — {fmtMD(range.end)}
          </span>
        </div>
        <div className="flex items-center gap-5">
          <Stat value={stats.active} label="진행 중" />
          <Stat value={stats.wait} label="대기" />
          <Stat
            value={stats.imminent}
            label="마감 임박"
            valueClass={stats.imminent > 0 ? "text-danger" : undefined}
          />
          <Stat value={stats.total} label="전체" />
        </div>
      </div>

      {/* ===== 컨트롤: 축 전환 + 필터 칩 + 줌 (덱 tier-filter-widget) ===== */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-navy/10 bg-card p-0.5">
            {(
              [
                ["project", "프로젝트별"],
                ["person", "인원별"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setAxis(key)}
                className={
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
                  (axis === key
                    ? "bg-navy text-white"
                    : "text-navy/50 hover:text-navy")
                }
              >
                {label}
              </button>
            ))}
          </div>

          {isDirector && (
            <div className="flex items-center gap-1 rounded-lg border border-navy/10 bg-card px-1.5 py-1">
              <FilterChip
                active={workerFilter === null}
                onClick={() => setWorkerFilter(null)}
              >
                전체
              </FilterChip>
              {data.profiles.map((p) => (
                <FilterChip
                  key={p.id}
                  active={workerFilter === p.id}
                  onClick={() =>
                    setWorkerFilter(workerFilter === p.id ? null : p.id)
                  }
                  dotColor={p.color}
                >
                  {p.name}
                </FilterChip>
              ))}
            </div>
          )}

          {data.clients.length > 1 && (
            <div className="flex items-center gap-1 rounded-lg border border-navy/10 bg-card px-1.5 py-1">
              <FilterChip
                active={clientFilter === null}
                onClick={() => setClientFilter(null)}
              >
                전체 업체
              </FilterChip>
              {data.clients.map((c) => (
                <FilterChip
                  key={c.id}
                  active={clientFilter === c.id}
                  onClick={() =>
                    setClientFilter(clientFilter === c.id ? null : c.id)
                  }
                >
                  {c.name}
                </FilterChip>
              ))}
            </div>
          )}
        </div>

        <div className="flex rounded-lg border border-navy/10 bg-card p-0.5">
          {(
            [
              ["day", "일"],
              ["week", "주"],
              ["month", "월"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setZoom(key)}
              className={
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
                (zoom === key
                  ? "bg-gold text-white"
                  : "text-navy/50 hover:text-navy")
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ===== TODAY 스트립 (덱 today-strip) ===== */}
      {todayCards.length > 0 && (
        <div className="flex items-stretch gap-3 rounded-xl border border-black/5 bg-card px-4 py-3 shadow-sm">
          <div className="flex shrink-0 flex-col justify-center border-r border-navy/10 pr-4">
            <span className="text-[10px] font-bold uppercase tracking-widest text-gold">
              Today
            </span>
            <span className="text-sm font-semibold text-navy">
              {fmtMDW(base)}
            </span>
          </div>
          <div className="flex flex-1 flex-wrap gap-2">
            {todayCards.map(({ task, kind, dday }) => {
              const prof = task.assignee_id
                ? profileById.get(task.assignee_id)
                : null;
              const proj = projectById.get(task.project_id);
              return (
                <div
                  key={task.id}
                  className="flex items-center gap-2.5 rounded-lg border border-black/5 bg-bg/70 px-3 py-2"
                >
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: prof?.color ?? "#9B9B9B" }}
                  />
                  <div className="flex flex-col">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-navy/40">
                      {proj?.code} · {prof?.name ?? "미배정"}
                    </span>
                    <span className="flex items-center gap-1.5 text-sm font-medium text-navy">
                      {task.name}
                      {kind === "imminent" ? (
                        <span className="rounded bg-danger/10 px-1.5 py-0.5 text-[10px] font-bold text-danger">
                          ⚠ {dday}
                        </span>
                      ) : (
                        <span className="rounded bg-gold/15 px-1.5 py-0.5 text-[10px] font-bold text-gold">
                          진행 중
                        </span>
                      )}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ===== 타임라인 본체 ===== */}
      <div className="overflow-hidden rounded-xl border border-black/5 bg-card shadow-sm">
        <div className="overflow-x-auto">
          <div style={{ width: LEFT_W + bodyW, minWidth: "100%" }}>
            {/* --- 시간 헤더 --- */}
            <div
              className="sticky top-0 z-30 flex border-b border-navy/10 bg-card"
              style={{ height: 52 }}
            >
              <div
                className="sticky left-0 z-40 flex shrink-0 items-end border-r border-navy/10 bg-card px-3 pb-1.5"
                style={{ width: LEFT_W }}
              >
                <span className="text-[11px] font-semibold uppercase tracking-widest text-navy/35">
                  {axis === "project" ? "클라이언트 / 프로젝트" : "작업자"}
                </span>
              </div>
              <div className="relative" style={{ width: bodyW }}>
                {headerCells.months.map((m) => (
                  <div
                    key={m.label + m.left}
                    className="absolute top-1 truncate border-l border-navy/10 pl-2 text-[11px] font-bold text-navy/60"
                    style={{ left: m.left, width: m.width }}
                  >
                    {m.label}
                  </div>
                ))}
                {headerCells.subs.map((s) => (
                  <div
                    key={s.left}
                    className={
                      "absolute bottom-1 text-[10px] font-medium " +
                      (s.muted ? "text-danger/50" : "text-navy/40")
                    }
                    style={{ left: s.left + 3, width: Math.max(dayW - 4, 26) }}
                  >
                    {s.label}
                  </div>
                ))}
                {/* 오늘 라벨 */}
                <div
                  className="absolute top-0 z-10 -translate-x-1/2 rounded-b bg-gold px-1.5 py-0.5 text-[10px] font-bold text-white"
                  style={{ left: todayX }}
                >
                  오늘 {fmtMD(base)}
                </div>
              </div>
            </div>

            {/* --- 행 영역 --- */}
            <div className="relative">
              {/* 배경 레이어: 주말/그리드/오늘선 — 좌측 컬럼 밖 */}
              <div
                className="pointer-events-none absolute inset-y-0 z-0"
                style={{ left: LEFT_W, width: bodyW, height: totalRowsH }}
              >
                {weekendBands.map((left) => (
                  <div
                    key={left}
                    className="absolute inset-y-0 bg-navy/[0.025]"
                    style={{ left, width: dayW }}
                  />
                ))}
                {gridLines.map((l) => (
                  <div
                    key={l.left}
                    className={
                      "absolute inset-y-0 w-px " +
                      (l.strong ? "bg-navy/10" : "bg-navy/[0.04]")
                    }
                    style={{ left: l.left }}
                  />
                ))}
                <div
                  className="absolute inset-y-0 w-0.5 bg-gold"
                  style={{ left: todayX }}
                />
              </div>

              {/* 행 렌더 */}
              {rows.length === 0 && (
                <div className="px-4 py-10 text-center text-sm text-navy/40">
                  표시할 태스크가 없습니다.
                </div>
              )}
              {rows.map((row, i) => (
                <TimelineRow
                  key={
                    row.kind === "task"
                      ? row.task.id
                      : `${row.kind}-${"id" in row ? row.id : i}`
                  }
                  row={row}
                  x={x}
                  dayW={dayW}
                  bodyW={bodyW}
                  base={base}
                  onToggle={toggleCollapse}
                />
              ))}
            </div>
          </div>
        </div>

        {/* --- 레전드 푸터 (덱 interaction-hint) --- */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-navy/10 bg-bg/50 px-4 py-2.5 text-[11px] text-navy/50">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-6 rounded-sm bg-navy/70" /> 진행 중
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-6 rounded-sm bg-navy/70 opacity-45" /> 완료
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-6 rounded-sm border border-dashed border-navy/50" />{" "}
            대기
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rotate-45 bg-gold" /> 마일스톤
          </span>
          <span className="flex items-center gap-1.5 text-danger">
            ⚠ 마감 임박 (D-3 이내)
          </span>
          <span className="ml-auto text-navy/30">
            바 색 = 작업자 · 클릭 = 상세 (5단계)
          </span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Stat({
  value,
  label,
  valueClass,
}: {
  value: number;
  label: string;
  valueClass?: string;
}) {
  return (
    <div className="flex flex-col items-center">
      <span
        className={
          "text-lg font-bold leading-tight tabular-nums " +
          (valueClass ?? "text-navy")
        }
      >
        {value}
      </span>
      <span className="text-[10px] font-medium text-navy/40">{label}</span>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  dotColor,
  children,
}: {
  active: boolean;
  onClick: () => void;
  dotColor?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors " +
        (active ? "bg-navy text-white" : "text-navy/50 hover:bg-navy/5")
      }
    >
      {dotColor && (
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: dotColor }}
        />
      )}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
function TimelineRow({
  row,
  x,
  dayW,
  bodyW,
  base,
  onToggle,
}: {
  row: Row;
  x: (d: Date) => number;
  dayW: number;
  bodyW: number;
  base: Date;
  onToggle: (id: string) => void;
}) {
  const h = ROW_H[row.kind];

  // ----- 좌측 라벨 -----
  let label: React.ReactNode;
  let labelBg = "bg-card";
  if (row.kind === "client") {
    labelBg = "bg-navy/[0.04]";
    label = (
      <div className="flex w-full items-center justify-between">
        <span className="truncate text-[11px] font-bold uppercase tracking-wider text-navy/60">
          {row.label}
        </span>
        <span className="text-[10px] tabular-nums text-navy/35">
          {row.count}
        </span>
      </div>
    );
  } else if (row.kind === "project") {
    label = (
      <div className="flex w-full items-center gap-1.5">
        <button
          onClick={() => onToggle(row.id)}
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-[9px] text-navy/40 hover:bg-navy/10"
          aria-label={row.collapsed ? "펼치기" : "접기"}
        >
          {row.collapsed ? "▶" : "▼"}
        </button>
        <span className="shrink-0 rounded bg-navy/8 px-1 py-0.5 text-[9px] font-bold tracking-wide text-navy/55">
          {row.code}
        </span>
        <span className="truncate text-[13px] font-semibold text-navy">
          {row.label}
        </span>
        <Link
          href={`/projects/${row.id}/board`}
          className="ml-auto shrink-0 rounded p-0.5 text-[13px] leading-none opacity-40 transition-opacity hover:opacity-100"
          title="레퍼런스 보드"
        >
          🖼
        </Link>
      </div>
    );
  } else if (row.kind === "person") {
    labelBg = "bg-navy/[0.04]";
    label = (
      <div className="flex w-full items-center gap-2">
        <span
          className="h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: row.color }}
        />
        <span className="truncate text-[13px] font-bold text-navy">
          {row.label}
        </span>
        <span className="ml-auto text-[10px] tabular-nums text-navy/35">
          진행 {row.count}
        </span>
      </div>
    );
  } else {
    const t = row.task;
    label = (
      <div className="flex w-full items-center gap-1.5 pl-5">
        {row.projectLabel && (
          <span className="shrink-0 rounded bg-navy/8 px-1 py-0.5 text-[9px] font-bold text-navy/50">
            {row.projectLabel}
          </span>
        )}
        <span className="truncate text-[12px] text-navy/80">{t.name}</span>
        {!row.projectLabel && (
          <span className="ml-auto flex shrink-0 items-center gap-1 text-[10px] text-navy/35">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: row.color }}
            />
            {row.assigneeName}
          </span>
        )}
      </div>
    );
  }

  // ----- 우측 콘텐츠 -----
  return (
    <div
      className="flex border-b border-navy/[0.05]"
      style={{ height: h }}
    >
      <div
        className={`sticky left-0 z-20 flex shrink-0 items-center border-r border-navy/10 px-3 ${labelBg}`}
        style={{ width: LEFT_W }}
      >
        {label}
      </div>
      <div className="relative z-10" style={{ width: bodyW }}>
        {row.kind === "project" && (
          <>
            {/* 프로젝트 기간 스트립 */}
            {row.extent && (
              <div
                className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-navy/15"
                style={{
                  left: x(row.extent.start),
                  width: x(row.extent.end) - x(row.extent.start) + dayW,
                }}
              />
            )}
            {/* 마일스톤 ◆ */}
            {row.milestones.map((m) => (
              <div
                key={m.id}
                className="group absolute top-1/2 z-10"
                style={{ left: x(m.due) + dayW / 2 }}
              >
                <div className="h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 border border-white bg-gold shadow-sm" />
                <div className="pointer-events-none absolute left-0 top-2.5 z-30 hidden -translate-x-1/2 whitespace-nowrap rounded bg-navy px-1.5 py-0.5 text-[10px] font-medium text-white group-hover:block">
                  ◆ {m.label} · {fmtMD(m.due)}
                </div>
              </div>
            ))}
          </>
        )}
        {row.kind === "task" && (
          <TaskBar task={row.task} color={row.color} x={x} dayW={dayW} base={base} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function TaskBar({
  task,
  color,
  x,
  dayW,
  base,
}: {
  task: TLTask;
  color: string;
  x: (d: Date) => number;
  dayW: number;
  base: Date;
}) {
  const s = parseDate(task.start_date);
  const e = parseDate(task.end_date);
  const left = x(s);
  const width = Math.max(x(e) - left + dayW - 2, 8);
  const imminent = isImminent(task.end_date, task.status, base);

  // 상태 표현 (스펙 3장): 완료=채움+45% / 진행=채움 / 대기=점선 외곽선
  const style: React.CSSProperties = { left, width };
  let cls =
    "absolute top-1/2 flex h-[22px] -translate-y-1/2 items-center gap-1 overflow-hidden rounded-md px-2 text-[11px] font-medium leading-none";
  if (task.status === "done") {
    style.backgroundColor = color;
    style.opacity = 0.45;
    cls += " text-white";
  } else if (task.status === "active") {
    style.backgroundColor = color;
    cls += " text-white shadow-sm";
  } else {
    style.border = `1.5px dashed ${color}`;
    style.color = color;
    cls += " bg-white/60";
  }
  if (imminent) {
    style.boxShadow = "0 0 0 1.5px var(--color-danger)";
  }

  return (
    <div
      className={cls + " cursor-pointer"}
      style={style}
      title={`${task.name} · ${fmtMD(s)}–${fmtMD(e)} (${
        task.status === "done" ? "완료" : task.status === "active" ? "진행 중" : "대기"
      })`}
    >
      {width > 60 && <span className="truncate">{task.name}</span>}
      {imminent && (
        <span className="ml-auto shrink-0 text-[10px] font-bold text-danger">
          ⚠
        </span>
      )}
    </div>
  );
}
