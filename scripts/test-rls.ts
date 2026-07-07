/**
 * RLS 스모크 테스트 — 실제 세션(매직링크 token_hash → verifyOtp)으로 role별 검증.
 * 실행: npx tsx scripts/test-rls.ts
 * (전체 검증 스위트는 12단계에서 확장)
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal, requireEnv } from "./db";

const env = loadEnvLocal();
const URL = requireEnv(env, "NEXT_PUBLIC_SUPABASE_URL");
const ANON = requireEnv(env, "NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE = requireEnv(env, "SUPABASE_SERVICE_ROLE_KEY");

const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name} ${detail}`);
  }
}

/** 이메일+비밀번호로 실제 로그인 세션 클라이언트 생성 */
async function signIn(email: string) {
  const client = createClient(URL, ANON, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email,
    password: env.SEED_USER_PASSWORD || "oddity1234",
  });
  if (error) throw error;
  return client;
}

async function main() {
  console.log("— freelancer (박한나) 세션 —");
  const hana = await signIn("kkwn0413+hana@gmail.com");

  const { data: myTasks } = await hana.from("tasks").select("id, name");
  check(
    "자기 배정 태스크만 조회 (4건)",
    (myTasks ?? []).length === 4,
    `got ${myTasks?.length}`,
  );

  const { data: fin } = await hana.from("task_finance").select("*");
  check("task_finance 0건 (단가 차단)", (fin ?? []).length === 0);

  const { data: proc } = await hana.from("proc_items").select("*");
  check("proc_items 0건 (선발주 차단)", (proc ?? []).length === 0);

  const { data: notes } = await hana.from("personal_notes").select("*");
  check(
    "personal_notes 본인 1건만",
    (notes ?? []).length === 1 && notes![0].body.includes("라벨 그리드"),
  );

  const { data: projects } = await hana.from("projects").select("code");
  const codes = (projects ?? []).map((p) => p.code).sort();
  check(
    "배정 프로젝트만 조회 (ZONE2, CARD, PENG)",
    codes.join(",") === "CARD,PENG,ZONE2",
    codes.join(","),
  );

  // 상태 변경은 허용
  const taskId = myTasks![0].id;
  const { error: statusErr } = await hana
    .from("tasks")
    .update({ status: "active" })
    .eq("id", taskId);
  check("본인 태스크 status 변경 허용", !statusErr, statusErr?.message);

  // 기간 변경은 trigger가 차단
  const { error: dateErr } = await hana
    .from("tasks")
    .update({ end_date: "2026-12-31" })
    .eq("id", taskId);
  check("본인 태스크 기간 변경 차단", !!dateErr);

  // verdict 직접 변경은 trigger가 차단
  const { data: img } = await hana.from("ref_images").select("id").limit(1);
  if (img?.length) {
    const { error: vErr } = await hana
      .from("ref_images")
      .update({ verdict: "good", verdict_memo: "해킹" })
      .eq("id", img[0].id);
    check("verdict 직접 변경 차단", !!vErr);

    const { error: rpcErr } = await hana.rpc("set_verdict", {
      p_image_id: img[0].id,
      p_verdict: "good",
      p_memo: "freelancer가 호출",
    });
    check("set_verdict RPC 호출 차단 (director 아님)", !!rpcErr);

    // 큐레이션(★)은 허용
    const { error: starErr } = await hana
      .from("ref_images")
      .update({ starred: true })
      .eq("id", img[0].id);
    check("★ 큐레이션 허용", !starErr, starErr?.message);
  }

  console.log("\n— director (김오디) 세션 —");
  const director = await signIn("kkwn0413@gmail.com");

  const { data: allTasks } = await director.from("tasks").select("id");
  check("전체 태스크 조회 (12건)", (allTasks ?? []).length === 12);

  const { data: dFin } = await director.from("task_finance").select("*");
  check("task_finance 조회 (4건)", (dFin ?? []).length === 4);

  const { data: dNotes } = await director.from("personal_notes").select("*");
  check(
    "타인 personal_notes 차단 (본인 1건만)",
    (dNotes ?? []).length === 1 && dNotes![0].body.includes("동판"),
  );

  const { data: dImg } = await director
    .from("ref_images")
    .select("id")
    .is("verdict", null)
    .limit(1);
  const { error: dRpcErr } = await director.rpc("set_verdict", {
    p_image_id: dImg![0].id,
    p_verdict: "good",
    p_memo: "테스트 판정 — 구조 참고 좋음",
  });
  check("director set_verdict 성공", !dRpcErr, dRpcErr?.message);

  const { error: noMemoErr } = await director.rpc("set_verdict", {
    p_image_id: dImg![0].id,
    p_verdict: "bad",
    p_memo: "",
  });
  check("이유 없는 판정 거부", !!noMemoErr);

  // 원복
  await director.rpc("set_verdict", {
    p_image_id: dImg![0].id,
    p_verdict: null as unknown as string,
    p_memo: null as unknown as string,
  });

  const { data: ev } = await director
    .from("events")
    .select("type")
    .eq("type", "ref.verdict");
  check("판정 이벤트 기록됨", (ev ?? []).length >= 1);

  console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("❌ 테스트 실패:", e.message ?? e);
  process.exit(1);
});
