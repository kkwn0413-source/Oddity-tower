/**
 * 개발용 시드 스크립트 (스펙 8장).
 * 실행: npm run seed
 *
 * ⚠ 도메인 테이블을 전부 비우고 다시 채운다 — 개발 환경 전용.
 * auth 사용자는 이메일 기준으로 재사용(없으면 생성).
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal, requireEnv } from "./db";

const env = loadEnvLocal();
const URL = requireEnv(env, "NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_KEY = requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");

const sb = createClient(URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------------------------------------------------------------------------
// 시드 계정 — 전부 gmail plus-addressing이라 실제 매직링크 수신 가능
// ---------------------------------------------------------------------------
const USERS = [
  { key: "director", email: "kkwn0413@gmail.com", name: "김오디", role: "director", color: "#B8965A" },
  { key: "hana", email: "kkwn0413+hana@gmail.com", name: "박한나", role: "freelancer", color: "#1D9E75" },
  { key: "jun", email: "kkwn0413+jun@gmail.com", name: "이준", role: "freelancer", color: "#7F77DD" },
  { key: "seo", email: "kkwn0413+seo@gmail.com", name: "최서우", role: "freelancer", color: "#D8643A" },
] as const;

type UserKey = (typeof USERS)[number]["key"];

/** 개발용 초기 비밀번호 — .env.local의 SEED_USER_PASSWORD로 재정의 가능 */
const SEED_PASSWORD = env.SEED_USER_PASSWORD || "oddity1234";

async function ensureUsers(): Promise<Record<UserKey, string>> {
  const { data, error } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  const byEmail = new Map(data.users.map((u) => [u.email?.toLowerCase(), u.id]));

  const ids = {} as Record<UserKey, string>;
  for (const u of USERS) {
    const existing = byEmail.get(u.email.toLowerCase());
    if (existing) {
      ids[u.key] = existing;
      // 비밀번호 로그인 전환 — 기존 계정에도 초기 비밀번호 보장
      const { error: e } = await sb.auth.admin.updateUserById(existing, {
        password: SEED_PASSWORD,
      });
      if (e) throw e;
      continue;
    }
    const { data: created, error: e } = await sb.auth.admin.createUser({
      email: u.email,
      password: SEED_PASSWORD,
      email_confirm: true,
    });
    if (e) throw e;
    ids[u.key] = created.user.id;
    console.log(`  + auth 사용자 생성: ${u.email}`);
  }
  return ids;
}

async function wipe() {
  // FK 역순으로 삭제 — [테이블, PK 컬럼]
  const tables: Array<[string, string]> = [
    ["feed_cursors", "user_id"],
    ["personal_notes", "id"],
    ["proc_items", "id"],
    ["direction_logs", "id"],
    ["meeting_comments", "id"],
    ["meeting_revisions", "id"],
    ["meeting_items", "id"],
    ["meetings", "id"],
    ["board_assets", "id"],
    ["ref_images", "id"],
    ["ref_zones", "id"],
    ["boards", "id"],
    ["share_links", "id"],
    ["comments", "id"],
    ["task_files", "id"],
    ["task_finance", "task_id"],
    ["events", "id"],
    ["tasks", "id"],
    ["milestones", "id"],
    ["projects", "id"],
    ["clients", "id"],
    ["profiles", "id"],
  ];
  for (const [t, pk] of tables) {
    const { error } = await sb.from(t).delete().not(pk, "is", null);
    if (error) throw new Error(`${t} 삭제 실패: ${error.message}`);
  }
  console.log("  기존 도메인 데이터 삭제");
}

async function ensureBuckets() {
  for (const name of ["task-files", "ref-images"]) {
    const { error } = await sb.storage.createBucket(name, { public: false });
    if (error && !/already exists/i.test(error.message)) throw error;
  }
  console.log("  Storage 버킷 확인: task-files, ref-images (private)");
}

function pic(seed: string, w: number, h: number) {
  return `https://picsum.photos/seed/${seed}/${w}/${h}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function insert<T extends object>(table: string, rows: T[]): Promise<any[]> {
  // PostgREST 다중 insert는 row마다 키가 다르면 누락 키를 null로 채운다.
  // 모든 row의 키 합집합으로 정규화하되, 누락분은 undefined 대신 제외되도록
  // defaultToNull:false 로 DB 기본값을 쓰게 한다.
  const { data, error } = await sb
    .from(table)
    .insert(rows, { defaultToNull: false })
    .select();
  if (error) throw new Error(`${table} insert 실패: ${error.message}`);
  return data!;
}

async function main() {
  console.log("시드 시작 →", URL);

  console.log("[1/6] auth 사용자");
  const uid = await ensureUsers();

  console.log("[2/6] 초기화");
  await wipe();
  await ensureBuckets();

  console.log("[3/6] 프로필/클라이언트/프로젝트");
  await insert("profiles", USERS.map((u) => ({
    id: uid[u.key], name: u.name, role: u.role, color: u.color,
  })));

  const clients = await insert("clients", [
    { name: "존투컴퍼니", memo: "패키지 리뉴얼 정기 발주처" },
    { name: "카드웍스", memo: "인쇄물 위주, 결제 빠름" },
    { name: "펭귄상회", memo: "캐릭터 IP 굿즈" },
    { name: "스튜디오인템", memo: "공간 그래픽 협업사" },
  ]);
  const [cZone, cCard, cPeng, cInt] = clients.map((c) => c.id);

  const projects = await insert("projects", [
    { client_id: cZone, name: "존2 패키지 리뉴얼", code: "ZONE2", status: "active", prod_anchor_date: "2026-08-21" },
    { client_id: cCard, name: "카드웍스 브로슈어", code: "CARD", status: "active" },
    { client_id: cPeng, name: "펭귄 캐릭터 굿즈", code: "PENG", status: "active" },
    { client_id: cInt, name: "쇼룸 인테리어 그래픽", code: "INT", status: "hold" },
  ]);
  const [pZone, pCard, pPeng, pInt] = projects.map((p) => p.id);

  console.log("[4/6] 마일스톤/태스크/단가");
  await insert("milestones", [
    { project_id: pZone, label: "1차 시안 리뷰", due_date: "2026-07-18" },
    { project_id: pCard, label: "인쇄 발주", due_date: "2026-07-31" },
    { project_id: pPeng, label: "샘플 발주", due_date: "2026-08-05" },
    { project_id: pInt, label: "시공 도면 확정", due_date: "2026-08-28" },
  ]);

  const tasks = await insert("tasks", [
    // ZONE2
    { project_id: pZone, name: "리서치·무드보드", assignee_id: uid.hana, start_date: "2026-06-22", end_date: "2026-06-30", status: "done", sort_order: 1 },
    { project_id: pZone, name: "패키지 구조 설계", assignee_id: uid.jun, start_date: "2026-06-29", end_date: "2026-07-10", status: "active", sort_order: 2, description: "합지 박스 + 내지 트레이 구조" },
    { project_id: pZone, name: "라벨 그래픽 시안", assignee_id: uid.hana, start_date: "2026-07-06", end_date: "2026-07-17", status: "active", sort_order: 3 },
    { project_id: pZone, name: "목업·인쇄 감리", assignee_id: uid.seo, start_date: "2026-07-27", end_date: "2026-08-07", status: "wait", sort_order: 4 },
    // CARD
    { project_id: pCard, name: "콘텐츠 구성안", assignee_id: uid.jun, start_date: "2026-06-15", end_date: "2026-06-24", status: "done", sort_order: 1 },
    { project_id: pCard, name: "본문 레이아웃", assignee_id: uid.jun, start_date: "2026-07-01", end_date: "2026-07-15", status: "active", sort_order: 2 },
    { project_id: pCard, name: "표지 디자인", assignee_id: uid.hana, start_date: "2026-07-13", end_date: "2026-07-22", status: "wait", sort_order: 3 },
    // PENG — "캐릭터 리파인"은 오늘(7/8) 마감 → 마감 임박 ⚠ 케이스
    { project_id: pPeng, name: "캐릭터 리파인", assignee_id: uid.seo, start_date: "2026-06-29", end_date: "2026-07-09", status: "active", sort_order: 1 },
    { project_id: pPeng, name: "굿즈 적용 시안", assignee_id: uid.seo, start_date: "2026-07-09", end_date: "2026-07-21", status: "wait", sort_order: 2 },
    { project_id: pPeng, name: "스토어 상세페이지", assignee_id: uid.hana, start_date: "2026-07-20", end_date: "2026-07-31", status: "wait", sort_order: 3 },
    // INT
    { project_id: pInt, name: "사이니지 시스템", assignee_id: uid.jun, start_date: "2026-08-03", end_date: "2026-08-14", status: "wait", sort_order: 1 },
    { project_id: pInt, name: "월그래픽 시안", assignee_id: uid.seo, start_date: "2026-08-10", end_date: "2026-08-21", status: "wait", sort_order: 2 },
  ]);
  const tByName = new Map(tasks.map((t) => [t.name, t.id]));

  await insert("task_finance", [
    { task_id: tByName.get("패키지 구조 설계"), fee: 1200000, withholding: true },
    { task_id: tByName.get("라벨 그래픽 시안"), fee: 900000, withholding: true },
    { task_id: tByName.get("본문 레이아웃"), fee: 800000, withholding: true, paid_at: null, memo: "선금 30% 지급 협의" },
    { task_id: tByName.get("캐릭터 리파인"), fee: 700000, withholding: false },
  ]);

  console.log("[5/6] 보드 (프로젝트/개인/공유) + 레퍼런스");
  const boards = await insert("boards", [
    { kind: "project", project_id: pZone, title: "존2 패키지 리뉴얼" },
    { kind: "project", project_id: pCard, title: "카드웍스 브로슈어" },
    { kind: "project", project_id: pPeng, title: "펭귄 캐릭터 굿즈" },
    { kind: "project", project_id: pInt, title: "쇼룸 인테리어 그래픽" },
    { kind: "shared", title: "오디티 공용 보드" },
    { kind: "personal", owner_id: uid.director, title: "김오디 수집함" },
    { kind: "personal", owner_id: uid.hana, title: "박한나 수집함", shared: true },
    { kind: "personal", owner_id: uid.jun, title: "이준 수집함" },
    { kind: "personal", owner_id: uid.seo, title: "최서우 수집함" },
  ]);
  const bZone = boards[0].id;
  const bShared = boards[4].id;
  const bHana = boards[6].id;

  const zones = await insert("ref_zones", [
    { board_id: bZone, title: "무드·톤", sort_order: 1, batch_label: "26.06.24 · 킥오프 수집" },
    { board_id: bZone, title: "패키지 구조", sort_order: 2, batch_label: "26.07.06 · 시안 수령" },
    { board_id: bZone, title: "타이포·로고", sort_order: 3 },
  ]);
  const [zMood, zStruct, zType] = zones.map((z) => z.id);
  const now = new Date().toISOString();

  await insert("ref_images", [
    // 무드·톤 4장 — 2장 판정(good/bad)
    { zone_id: zMood, uploader_id: uid.hana, kind: "url", url: pic("oddity-m1", 800, 1050), starred: true, memo: "네이비+골드 톤 레퍼런스", sort_order: 1,
      verdict: "good", verdict_memo: "우리가 가려는 딥네이비 채도가 정확함. 금박 면적도 이 정도가 상한선.", verdict_by: uid.director, verdict_at: now },
    { zone_id: zMood, uploader_id: uid.hana, kind: "url", url: pic("oddity-m2", 800, 800), sort_order: 2,
      verdict: "bad", verdict_memo: "채도가 너무 높아 프리미엄 라인과 어긋남. 이런 원색 계열은 제외.", verdict_by: uid.director, verdict_at: now },
    { zone_id: zMood, uploader_id: uid.jun, kind: "url", url: pic("oddity-m3", 800, 1200), memo: "질감 참고용", sort_order: 3 },
    { zone_id: zMood, uploader_id: uid.hana, kind: "url", url: pic("oddity-m4", 800, 600), hidden: true, memo: "방향 틀어져서 숨김", sort_order: 4 },
    // 패키지 구조 3장 — doc_group 스트립 (다페이지 문서)
    { zone_id: zStruct, uploader_id: uid.jun, kind: "url", url: pic("oddity-s1", 900, 640), doc_group: "structure-deck", sort_order: 1,
      verdict: "good", verdict_memo: "뚜껑-바디 결합부 디테일이 우리 단가로 구현 가능한 수준. 이 구조로 진행.", verdict_by: uid.director, verdict_at: now },
    { zone_id: zStruct, uploader_id: uid.jun, kind: "url", url: pic("oddity-s2", 900, 640), doc_group: "structure-deck", sort_order: 2 },
    { zone_id: zStruct, uploader_id: uid.jun, kind: "url", url: pic("oddity-s3", 900, 640), doc_group: "structure-deck", starred: true, sort_order: 3 },
    // 타이포·로고 3장 — 1장 bad 판정
    { zone_id: zType, uploader_id: uid.seo, kind: "url", url: pic("oddity-t1", 800, 1000), starred: true, memo: "세리프 후보 1", sort_order: 1 },
    { zone_id: zType, uploader_id: uid.seo, kind: "url", url: pic("oddity-t2", 800, 900), sort_order: 2,
      verdict: "bad", verdict_memo: "장식성이 과해서 라벨 소형 사이즈에서 뭉개짐. 획 대비 낮은 쪽으로.", verdict_by: uid.director, verdict_at: now },
    { zone_id: zType, uploader_id: uid.hana, kind: "url", url: pic("oddity-t3", 800, 1100), sort_order: 3 },
  ]);

  // 공유 보드 + 개인 보드(박한나, shared=true) 콘텐츠
  const [zShared] = await insert("ref_zones", [
    { board_id: bShared, title: "하우스 공용 무드", sort_order: 1 },
  ]);
  const [zHana] = await insert("ref_zones", [
    { board_id: bHana, title: "종이 질감 수집", sort_order: 1 },
  ]);
  await insert("ref_images", [
    { zone_id: zShared.id, uploader_id: uid.director, kind: "url", url: pic("oddity-shared1", 800, 1000), memo: "하우스 기본 톤 기준", sort_order: 1 },
    { zone_id: zShared.id, uploader_id: uid.jun, kind: "url", url: pic("oddity-shared2", 800, 700), sort_order: 2 },
    { zone_id: zHana.id, uploader_id: uid.hana, kind: "url", url: pic("oddity-hana1", 800, 1100), starred: true, memo: "코튼지 압인 샘플", sort_order: 1 },
  ]);

  // 차수별 회의록 (ZONE2 보드) — 유지/추가/제거 항목 + 첨삭 코멘트
  const [m1] = await insert("meetings", [
    { board_id: bZone, round: 1, title: "킥오프 — 방향 정리", met_at: "2026-06-24", author_id: uid.director,
      body: "프리미엄 라인 리뉴얼 킥오프. 기존 패키지 대비 톤 정리가 핵심." },
  ]);
  await insert("meeting_items", [
    { meeting_id: m1.id, kind: "add", body: "네이비+골드 프리미엄 무드 기준 확정", sort_order: 0 },
    { meeting_id: m1.id, kind: "add", body: "합지 박스 구조 후보 3종 수집", sort_order: 1 },
    { meeting_id: m1.id, kind: "note", body: "다음 미팅까지 라벨 시안 2안 준비 (박한나)", sort_order: 2 },
  ]);
  const [m2] = await insert("meetings", [
    { board_id: bZone, round: 2, title: "1차 시안 리뷰", met_at: "2026-07-06", author_id: uid.director,
      body: "구조 B안 채택. 라벨 마감 방향 변경." },
  ]);
  await insert("meeting_items", [
    { meeting_id: m2.id, kind: "keep", body: "박스 구조 B안 유지 — 뚜껑 결합부 그대로", sort_order: 0 },
    { meeting_id: m2.id, kind: "remove", body: "전면 유광 코팅 제외", sort_order: 1 },
    { meeting_id: m2.id, kind: "add", body: "무광 베이스 + 로고 스팟 UV로 변경", sort_order: 2 },
  ]);
  await insert("meeting_comments", [
    { meeting_id: m2.id, author_id: uid.hana, body: "스팟 UV 범위가 로고만인지 패턴까지인지 확인 필요합니다." },
  ]);

  // 보드 파일 링크
  await insert("board_assets", [
    { board_id: bZone, name: "드라이브", url: "https://drive.google.com/drive/folders/example", sort_order: 0 },
    { board_id: bZone, name: "피그마", url: null, sort_order: 1 },
  ]);

  // 방향 로그 3건 — 1건은 supersedes 이력 (L3가 L2를 대체, trigger가 L2를 superseded 처리)
  const [l1] = await insert("direction_logs", [
    { project_id: pZone, author_id: uid.director, body: "메인 팔레트는 딥네이비 + 골드 유지. 배경 아이보리는 #F6F4EF 계열.", status: "confirmed" },
  ]);
  const [l2] = await insert("direction_logs", [
    { project_id: pZone, author_id: uid.director, body: "라벨 마감은 전면 유광 코팅으로 간다.", status: "open" },
  ]);
  await insert("direction_logs", [
    { project_id: pZone, author_id: uid.director, body: "라벨 마감 변경: 무광 베이스 + 로고만 부분 유광(스팟 UV).", status: "open", supersedes: l2.id },
  ]);
  void l1;

  console.log("[6/6] 선발주/개인 메모");
  // 마지노선 = 2026-08-21 − lead_weeks×7 − buffer_days
  await insert("proc_items", [
    { project_id: pZone, category: "인쇄", name: "박가공 동판", lead_weeks: 6, buffer_days: 3, vendor: "금성동판", memo: "재견적 필요" },            // 마지노선 7/7 — 경과!
    { project_id: pZone, category: "패키지", name: "합지 박스", lead_weeks: 4, buffer_days: 3, vendor: "대영지기", task_id: tByName.get("패키지 구조 설계") }, // 7/21
    { project_id: pZone, category: "패키지", name: "특수지 라벨지", lead_weeks: 2, buffer_days: 3, vendor: "두성종이" },                                   // 8/4
    { project_id: pZone, category: "부자재", name: "리본 타이", lead_weeks: 1, buffer_days: 3 },                                                          // 8/11
    { project_id: pZone, category: "부자재", name: "봉인 스티커", lead_weeks: 2, buffer_days: 3, ordered_at: "2026-07-01", vendor: "프린트시티" },        // 발주 완료
  ]);

  await insert("personal_notes", [
    { user_id: uid.director, project_id: pZone, body: "동판 업체 두 곳 재견적 — 금성 vs 신화. 금요일까지 결정." },
    { user_id: uid.hana, task_id: tByName.get("라벨 그래픽 시안"), body: "라벨 그리드 8열 기준으로 다시. 골드 면적 20% 넘기지 말 것." },
  ]);

  console.log("✅ 시드 완료");
  console.log("   director:", USERS[0].email);
  console.log("   freelancers:", USERS.slice(1).map((u) => u.email).join(", "));
  console.log("   초기 비밀번호:", SEED_PASSWORD);
}

main().catch((e) => {
  console.error("❌ 시드 실패:", e.message ?? e);
  process.exit(1);
});
