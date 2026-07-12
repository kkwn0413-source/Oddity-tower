-- =============================================================================
-- 0012 — 레퍼런스 정리(트리아지) 스키마 증축 (BRIEF Phase 2)
--
-- 클라이언트가 던진 무선별 레퍼런스 덤프를 "어느 공간/무엇을 참고" 단위로
-- 정리하기 위한 컬럼. 전부 add column if not exists — 기존 데이터 무손실.
-- RLS: ref_images/ref_zones 기존 정책을 그대로 따른다 (신규 정책 없음).
--   · 열람·수정은 can_access_zone / can_edit_zone (프로젝트 참여자 범위)
--   · 트리아지는 큐레이션(★/숨김/메모)과 동급의 정리 행위이므로 참여자 허용
--   · verdict* 컬럼(director 전용)은 이 마이그레이션과 무관 — 그대로 유지
-- =============================================================================

-- 원본 파일명 — 클라이언트 지시가 파일명에 담긴 경우가 많다("알전구", "허름한느낌")
alter table public.ref_images add column if not exists source_filename text;

-- AI 선분류 추정값 (Phase 3에서 채움)
alter table public.ref_images add column if not exists ai_zone_guess text;
alter table public.ref_images add column if not exists ai_aspect_guess text;

-- 사람이 확정한 참고 요소 (허용값은 코드 상수 lib/triage.ts:ASPECTS)
alter table public.ref_images add column if not exists aspect text;

-- 표시(마크) + 메모 그룹. 좌표는 이미지 비율 0~1.
-- { "marks": [ {"n":1,"shape":"ellipse"|"rect","x0":..,"y0":..,"x1":..,"y1":..} ],
--   "memo_groups": [ {"id":1,"memo":"이 질감으로","members":[1,3]} ] }
alter table public.ref_images add column if not exists annotation jsonb;

-- 트리아지 상태
alter table public.ref_images add column if not exists triage_status text
  not null default 'pending'
  check (triage_status in ('pending', 'confirmed', 'discarded'));
alter table public.ref_images add column if not exists triaged_by uuid references public.profiles(id);
alter table public.ref_images add column if not exists triaged_at timestamptz;

-- 구역 종류: 공간(space) / 기물(object)
alter table public.ref_zones add column if not exists kind text
  not null default 'space'
  check (kind in ('space', 'object'));

-- pending 카운트·정렬용 인덱스 (메인 위젯 Phase 5, 트리아지 순회 Phase 4)
create index if not exists idx_ref_images_triage
  on public.ref_images (zone_id, triage_status);
