/**
 * 레퍼런스 정리(트리아지) 공통 상수 (BRIEF Phase 2).
 * DB check 제약이 아니라 코드 상수로 관리 — UI 칩과 AI 프롬프트가 공유한다.
 */

/** 참고 요소(aspect) 허용값 — 순서가 곧 칩 노출 순서 */
export const ASPECTS = [
  "무드·색감",
  "형태·구조",
  "재질·질감",
  "조명",
  "그래픽·서체",
  "배치",
  "소품",
] as const;

export type Aspect = (typeof ASPECTS)[number];

/** 구역 종류 */
export const ZONE_KINDS = ["space", "object"] as const;
export type ZoneKind = (typeof ZONE_KINDS)[number];

export const TRIAGE_STATUSES = ["pending", "confirmed", "discarded"] as const;
export type TriageStatus = (typeof TRIAGE_STATUSES)[number];

/** 표시(마크) — annotation.marks[] 요소. 좌표는 이미지 비율 0~1. */
export type Mark = {
  n: number;
  shape: "ellipse" | "rect";
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

/** 메모 그룹 — annotation.memo_groups[] 요소. 여러 번호가 한 메모 공유. */
export type MemoGroup = {
  id: number;
  memo: string;
  members: number[];
};

export type Annotation = {
  marks: Mark[];
  memo_groups: MemoGroup[];
};

/** 카드당 목표 처리 시간(초) — 메인 위젯의 예상 소요 계산에 사용 */
export const SECONDS_PER_CARD = 3;
