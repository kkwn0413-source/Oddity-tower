/** AI 일정 반영 — 공용 타입 */

export type AiFields = {
  name?: string | null;
  description?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status?: string | null;
  assignee_id?: string | null;
};

export type AiSet = {
  id: string;
  summary: string;
  notes: string | null;
  status: "proposed" | "applied" | "cancelled";
  source_text: string;
  created_at: string;
  applied_at: string | null;
};

export type AiItem = {
  id: string;
  set_id: string;
  seq: number;
  action: "create" | "update" | "delete";
  task_id: string | null;
  project_id: string | null;
  assignee_id: string | null;
  summary: string;
  payload: AiFields;
  before: (AiFields & { id?: string }) | null;
  ack_status: "pending" | "agreed" | "disputed";
  ack_comment: string | null;
  applied: boolean;
};

export const ACTION_LABEL: Record<AiItem["action"], string> = {
  create: "생성",
  update: "수정",
  delete: "삭제",
};

export const STATUS_LABEL: Record<string, string> = {
  wait: "대기",
  active: "진행 중",
  done: "완료",
};

/** payload를 사람이 읽는 변경 요약 라인들로 */
export function fieldLines(item: AiItem): string[] {
  const f = item.payload ?? {};
  const b = item.before ?? {};
  const lines: string[] = [];
  if (item.action === "delete") {
    if (b.name) lines.push(`"${b.name}" 태스크 삭제`);
    return lines;
  }
  if (f.name && f.name !== b.name) lines.push(`이름: ${b.name ? `${b.name} → ` : ""}${f.name}`);
  if (f.start_date || f.end_date) {
    const from = b.start_date ? `${b.start_date} — ${b.end_date}` : null;
    const to = `${f.start_date ?? b.start_date ?? "?"} — ${f.end_date ?? b.end_date ?? "?"}`;
    lines.push(`기간: ${from && from !== to ? `${from} → ` : ""}${to}`);
  }
  if (f.status) lines.push(`상태: ${STATUS_LABEL[f.status] ?? f.status}`);
  if (f.description) lines.push(`설명: ${f.description}`);
  return lines;
}
