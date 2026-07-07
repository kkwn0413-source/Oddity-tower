/**
 * 작업자 색상 — profiles.color 에 저장되는 값.
 * 대표(director) = gold. 프리랜서 = 팔레트 순서대로 자동 배정.
 * 디자인 토큰(globals.css @theme)과 값이 일치해야 한다.
 */
export const DIRECTOR_COLOR = "#B8965A"; // gold

export const FREELANCER_PALETTE = [
  "#1D9E75",
  "#7F77DD",
  "#D8643A",
  "#2E7FB8",
] as const;

/**
 * 이미 배정된 색 목록을 받아 다음 프리랜서 색을 고른다.
 * 팔레트를 다 쓰면 사용 빈도가 가장 낮은 색을 재사용한다.
 */
export function nextFreelancerColor(usedColors: string[]): string {
  const counts = new Map<string, number>(
    FREELANCER_PALETTE.map((c) => [c, 0]),
  );
  for (const c of usedColors) {
    if (counts.has(c)) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  let best: string = FREELANCER_PALETTE[0];
  let min = Infinity;
  for (const c of FREELANCER_PALETTE) {
    const n = counts.get(c) ?? 0;
    if (n < min) {
      min = n;
      best = c;
    }
  }
  return best;
}
