@AGENTS.md

> 이 프로젝트는 Next.js 16 + React 19 + Tailwind v4 + Supabase 스택. 위 AGENTS.md 경고(Next.js 16 breaking changes)를 반드시 준수한다.
> 진행 현황은 아래 "빌드 순서"의 커밋 로그로 추적. 스택 결정: App Router, no src-dir, import alias `@/*`, Tailwind v4 CSS 토큰(`app/globals.css @theme`).

---

# 오디티하우스 컨트롤타워 — MVP 빌드 스펙

## 0. 진행 방식
- 아래 **12. 빌드 순서**를 단계별로 진행하고 각 단계 완료 시 커밋한다.
- Supabase URL/anon key가 없으면 시작 전 사용자에게 요청한다. (`.env.local` — 절대 커밋 금지)
- 스펙에 없는 판단이 필요하면 임의 확장하지 말고 사용자에게 물어본다.
- 타임라인 UI는 참조 파일 `oddity-timeline-prototype.jsx`가 있으면 그 구조·스타일 기준.

## 1. 제품 개요
- **무엇**: 디자인 프리랜서 컨트롤타워(오디티하우스)의 내부 프로젝트·일정·파일 관리 툴.
- **핵심 화면**: 위계형 타임라인 캘린더 (클라이언트 → 프로젝트 → 태스크).
- **프로젝트별 모듈**: ① 레퍼런스 보드(이미지 큐레이션 + 방향 로그) ② 선발주 트래커(제작 목표일 기준 발주 마지노선 역산, 대표 전용).
- **핵심 루프 — 디렉팅 피드백**: 디렉터가 레퍼런스 이미지를 좋음/나쁨 판정 + 이유 → 수행 인원 대시보드로 자동 전달. 업체별·프로젝트별 반복 사용 범용 협업 도구.
- **사용자**: 대표(director) 1 + 프리랜서(freelancer) 3~5. 발주처는 계정 없음 — 읽기 전용 공유 링크만.
- **설계 원칙**: 단가·정산은 데이터 레벨(RLS)에서 대표만 접근(뷰 가림 금지). 프리랜서 입력 마찰 최소화. 모든 변화는 events 로그.

## 2. 기술 스택
- Next.js 14+ (App Router, TS) — 실제 스캐폴딩은 Next 16.
- Supabase: Auth(이메일 매직링크), Postgres + RLS, Storage.
- Tailwind CSS(v4). 배포: Vercel(설정만, 배포는 사용자). 외부 연동은 링크 저장 수준만(Drive/Figma URL). OAuth 없음.

## 3. 디자인 토큰 (하우스 스타일)
- Navy `#0B1530` / Gold `#B8965A`. 배경 `#F6F4EF`, 카드 `#FFFFFF`.
- 폰트: Pretendard(CDN) fallback Apple SD Gothic Neo.
- 작업자 색: 대표 gold. 프리랜서 팔레트 `#1D9E75 #7F77DD #D8643A #2E7FB8` (profiles.color).
- 상태: 완료=채움+45%투명 / 진행중=채움 / 대기=점선 외곽선. 마일스톤=골드 다이아몬드(45°). 마감 임박=⚠ 빨강.

## 4. 데이터 모델 (Supabase 마이그레이션)
profiles / clients / projects(code unique, prod_anchor_date) / milestones / tasks(status wait|active|done) / task_finance(대표전용) / task_files(자동네이밍·version·approved) / comments(internal) / events(모든 mutation 기록) / share_links(token·include_board·revoked) / ref_zones / ref_images(starred·hidden·verdict good|bad·verdict_memo·doc_group) / direction_logs(open|confirmed|superseded, supersedes) / proc_items(대표전용, 발주 마지노선 = prod_anchor_date − lead_weeks×7 − buffer_days) / personal_notes(본인전용) / feed_cursors.
> 상세 컬럼 정의는 초기 프롬프트 원문(4장) 참조. 마이그레이션 SQL이 진실의 원천.

## 5. RLS 정책 (핵심)
- profiles: 본인 R/W, director 전체 R.
- clients/projects/milestones: director 전체 CRUD. freelancer는 자기 배정 태스크가 있는 프로젝트만 SELECT.
- tasks: director 전체. freelancer는 assignee=auth.uid() row만 SELECT + status/updated_at UPDATE(컬럼 제한 trigger/RPC 강제).
- task_finance: **director만**. freelancer 정책 없음.
- task_files/comments: director 전체. freelancer는 자기 태스크 범위 SELECT/INSERT.
- events: INSERT 인증사용자, SELECT director만.
- share_links: director만.
- ref_zones/ref_images/direction_logs: director 전체. freelancer는 배정 프로젝트 범위 SELECT/INSERT/UPDATE. direction_logs UPDATE/DELETE 금지(새 row만). verdict* 컬럼은 director만 — RPC `set_verdict` 경유, 일반 UPDATE는 trigger 차단.
- personal_notes: 본인만(타인 정책 없음, director 포함).
- feed_cursors: 본인만.
- proc_items: director만. freelancer 정책 없음.
- 공유 링크 열람: RLS 우회 아니라 `/api/share/[token]` service role + 반환 필드 화이트리스트(프로젝트명/마일스톤/태스크 name·기간·status·담당자이름 / approved=true 파일 / internal=false 코멘트). task_finance·proc_items·verdict_memo 쿼리 원천 배제.

## 6. 화면 (요약)
- `/` 타임라인: 프로젝트별/인원별 축 전환, 줌 3단(일44/주20/월10px), 좌측 236px sticky, 오늘 세로선(gold), 마감임박 ⚠, 발주 마지노선 마커(빨강 다이아, director만), 보드 아이콘, 우측 태스크 패널.
- `/share/[token]`: 비로그인 읽기전용. include_board=true면 보드 탭(hidden=false 이미지 + confirmed 로그, 이미지메모·verdict_memo 제외). proc_items 절대 제외.
- `/admin/share`: 링크 생성/목록/복사/철회 (director).
- 파일 업로드: 버킷 `task-files`(private), 자동 네이밍 `{code}_{task slug}_{작업자명}_v{NN}.{ext}`, 재업로드 시 version+1, signed URL 1h.
- `/login`: 이메일+비밀번호 (매직링크는 사용자 요청으로 제거 — 2026-07-08). 가입은 director 초대(계정+비밀번호 발급, profiles 사전 생성). 시드 초기 비밀번호: `oddity1234` (SEED_USER_PASSWORD로 재정의).
- `/projects/[id]/board`: 마소너리 + 큐레이션(★/숨김/메모) + 디렉팅 판정(RPC set_verdict, 이유 필수) + 판정 모아보기 + doc_group 스트립 + 방향 로그 + Realtime.
- `/projects/[id]/procure`: 대표전용. 마지노선 역산 D-day, 미발주+경과=빨강/7일이내=주황.
- `/me`: 내 태스크 + 디렉팅 피드백 피드(feed_cursors 안읽음) + 개인 메모. director는 "오늘의 관제" 추가.
- `/clients/[id]`: 업체 아카이브 — 프로젝트 목록 + confirmed 방향로그 모아보기.

## 7. 이벤트 로그
모든 쓰기 경로에서 events insert(payload에 before/after). 공통 헬퍼 `logEvent()` 강제.

## 8. 시드
클라이언트4 / 프로젝트4(ZONE2·CARD·PENG·INT) / 태스크12 / 마일스톤4 / 프로필4(director1+freelancer3). 보드: 1프로젝트에 구역3+이미지10(★/숨김/메모/doc_group, 4장 good/bad+이유), 방향로그3(1건 supersedes), prod_anchor_date1 + proc_items5(1건 마지노선 경과), 개인메모2.

## 9. Phase 2 (지금 제외)
Drive OAuth/Figma API, Claude 브리핑, 알림, 모바일 뷰, 서브태스크.

## 10. 품질 기준
TS strict. `supabase gen types`. RLS는 role별 테스트 계정 검증 스크립트 포함 — freelancer가 task_finance·proc_items 조회 불가, verdict 컬럼 변경 불가, 타인 personal_notes 조회 불가(director 포함), share API 응답에 fee·선발주·verdict_memo 없음, 공유 보드에 hidden·이미지메모 노출 없음. 한국어 UI, 날짜 M/D, 주 시작 월요일.

## 11. 환경 변수
`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`(서버 전용). 템플릿은 `.env.example`.

## 12. 빌드 순서 (단계별 커밋)
1. ✅ Next+Tailwind+Pretendard+토큰 셋업, 레이아웃 셸
2. ✅ Supabase 마이그레이션(스키마 전체) + RLS + 시드 — 적용은 `npm run db:apply`(SUPABASE_DB_URL 또는 SUPABASE_ACCESS_TOKEN), 시드는 `npm run seed`. 시드 계정: 대표 kkwn0413@gmail.com, 프리랜서 kkwn0413+hana/+jun/+seo@gmail.com
3. ✅ Auth(이메일+비밀번호) + profiles + director/freelancer 가드 — Next 16은 middleware 대신 proxy.ts. RLS 스모크: `npx tsx scripts/test-rls.ts`
4. ✅ 타임라인 읽기전용 렌더 + 프로젝트별/인원별 축 전환 — 프로토타입 jsx 대신 `campus_calendar_23slides_v6.html`(캘린더 공모전 덱)의 가시성 시스템을 이식: 메타 스탯 바(마감 임박 빨강), TODAY 스트립(진행 중/D-n 카드), 필터 칩 위젯, 오늘선 라벨, 레전드 푸터. 컴포넌트: components/timeline/
5. ✅ 태스크 상세 패널 — 상태변경·코멘트·director 생성/수정 + 단가(대표 전용 fetch) + internal 코멘트 RLS 강화(0008). 권한은 자율 결정(보수적, 대표 전용 우선 — 사용자 지시)
6. 파일 업로드(자동네이밍·버전) + Drive/Figma 링크 + signed URL
7. ✅ 레퍼런스 보드 전체 (7a 스키마 → 7b 조회 → 7c 편집/업로드 → 7d 판정 → 접근제한(board_members) → 개인수집함 완성 → 7e 회의록/방향로그 편집 → 7f Realtime+스케줄칩). 사용자 확장: 개인/공용 보드, 차수별 회의록+첨삭+이력, events 전원 공유(proc./finance. 제외), 인원별 접근 제한
8. `/me` (내 태스크 + 피드 + 개인메모, director 관제)
9. 선발주 트래커 + 타임라인 마지노선 마커
10. events 헬퍼 전 경로 + `/clients/[id]`
11. 공유 링크 관리 + `/share/[token]` + 화이트리스트 테스트
12. RLS 검증 테스트 + 마감임박 로직 + 폴리시(로딩/빈상태/에러)
