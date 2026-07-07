/** 날짜 유틸 — 전부 로컬 자정 기준 date-only. 주 시작 월요일, 표기 M/D. */

export function parseDate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function today(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

/** b - a 일수 (같은 날 = 0) */
export function diffDays(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

/** M/D 표기 (스펙 10장) */
export function fmtMD(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export const WEEKDAYS_KO = ["일", "월", "화", "수", "목", "금", "토"] as const;

export function fmtMDW(d: Date): string {
  return `${fmtMD(d)} (${WEEKDAYS_KO[d.getDay()]})`;
}

/** 해당 날짜가 속한 주의 월요일 */
export function mondayOf(d: Date): Date {
  const day = d.getDay(); // 0=일
  return addDays(d, day === 0 ? -6 : 1 - day);
}

export function isWeekend(d: Date): boolean {
  const w = d.getDay();
  return w === 0 || w === 6;
}

/** 마감 임박: 미완료 && 오늘 이후 마감 && D-3 이내 (스펙 6.1) */
export function isImminent(endISO: string, status: string, base: Date): boolean {
  if (status === "done") return false;
  const end = parseDate(endISO);
  const dd = diffDays(base, end);
  return dd >= 0 && dd <= 3;
}

/** D-day 라벨: D-3 / D-DAY / D+2 */
export function ddayLabel(target: Date, base: Date): string {
  const n = diffDays(base, target);
  if (n === 0) return "D-DAY";
  return n > 0 ? `D-${n}` : `D+${-n}`;
}
