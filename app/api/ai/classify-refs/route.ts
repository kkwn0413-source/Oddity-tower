import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";
import { ASPECTS } from "@/lib/triage";

/**
 * AI 선분류 (BRIEF Phase 3) — 레퍼런스 정리 트리아지의 사전 단계.
 * 이미지 + 파일명을 Claude에 전달해, 보드의 ref_zones(공간/기물) 안에서 공간을,
 * 참고 요소 7종 중 하나를 추정 → ai_zone_guess / ai_aspect_guess 저장.
 * triage_status는 건드리지 않는다(그대로 pending). 실패 이미지는 배열로 반환.
 *
 * app/api/ai/parse 의 인증·Anthropic 호출·에러 처리 패턴을 재사용.
 */

export const maxDuration = 300;

const CHUNK = 10; // Claude 비전 호출당 이미지 수 (토큰/크기 안정 범위)

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["results"],
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["index", "zone_guess", "aspect_guess", "one_liner"],
        properties: {
          index: { type: "integer", description: "이미지 번호 (프롬프트에 표시된 [이미지 N]의 N)" },
          zone_guess: {
            anyOf: [{ type: "string" }, { type: "null" }],
            description: "제공된 '보드 구역 목록' 중 정확히 하나. 어디에도 안 맞으면 null",
          },
          aspect_guess: {
            anyOf: [{ type: "string" }, { type: "null" }],
            description: "제공된 '참고 요소' 목록 중 정확히 하나. 애매하면 null",
          },
          one_liner: { type: "string", description: "왜 그렇게 봤는지 한국어 한 문장" },
        },
      },
    },
  },
} as const;

type ClassifyResult = {
  index: number;
  zone_guess: string | null;
  aspect_guess: string | null;
  one_liner: string;
};

type InputImage = { id: string; url: string; source_filename?: string | null };

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  if (!process.env.ANTHROPIC_API_KEY)
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY가 설정되지 않았습니다. .env.local에 추가 후 서버를 재시작해주세요." },
      { status: 500 },
    );

  const body = (await req.json()) as { board_id?: string; images?: InputImage[] };
  const boardId = body.board_id;
  const images = (body.images ?? []).filter((i) => i.id && i.url);
  if (!boardId) return NextResponse.json({ error: "board_id가 필요합니다." }, { status: 400 });
  if (images.length === 0)
    return NextResponse.json({ error: "분류할 이미지가 없습니다." }, { status: 400 });

  // ----- 보드 구역 목록 (user 세션 — RLS로 열람 권한 확인) -----
  const { data: zones } = await supabase
    .from("ref_zones")
    .select("title, kind")
    .eq("board_id", boardId)
    .order("sort_order");
  if (!zones || zones.length === 0)
    return NextResponse.json(
      { error: "보드에 구역이 없어 공간을 고를 수 없습니다. 먼저 구역을 만들어주세요." },
      { status: 422 },
    );

  // 제공된 이미지가 이 보드에 속하는지 검증 (user 세션 RLS 기준)
  const { data: boardImgs } = await supabase
    .from("ref_images")
    .select("id, source_filename")
    .in(
      "zone_id",
      (await supabase.from("ref_zones").select("id").eq("board_id", boardId)).data?.map(
        (z) => z.id,
      ) ?? [],
    );
  const allowed = new Map((boardImgs ?? []).map((i) => [i.id, i.source_filename]));
  const targets = images.filter((i) => allowed.has(i.id));
  if (targets.length === 0)
    return NextResponse.json(
      { error: "이 보드에서 접근 가능한 이미지가 없습니다." },
      { status: 403 },
    );

  const zoneTitles = zones.map((z) => `${z.title}${z.kind === "object" ? "(기물)" : ""}`);
  const system = `너는 디자인 스튜디오의 레퍼런스 정리 어시스턴트다.
클라이언트가 마구 던진 참고 이미지를 보고, 각 이미지가 "어느 공간/기물"의 "무엇"을
참고하라는 것인지 추정한다.

규칙:
- 공간(zone)은 아래 '보드 구역 목록'에 있는 값 중에서만 정확히 하나 고른다. 어디에도
  맞지 않으면 zone_guess는 null.
- 참고 요소(aspect)는 아래 목록 중 정확히 하나. 애매하면 null.
- **파일명이 가장 강한 신호다.** 파일명에 담긴 단어("알전구", "허름한느낌", "백월" 등)를
  최우선으로 반영한다. 파일명이 무의미하면(IMG_2841 등) 이미지 내용으로 판단한다.
- one_liner는 한국어 한 문장으로 근거를 짧게.
- 결과는 반드시 각 이미지의 index를 포함해 반환한다.

보드 구역 목록: ${zoneTitles.join(", ")}
참고 요소: ${ASPECTS.join(", ")}`;

  const validZones = new Set(zones.map((z) => z.title));
  const validAspects = new Set<string>(ASPECTS);
  const anthropic = new Anthropic();

  const classified: {
    id: string;
    zone_guess: string | null;
    aspect_guess: string | null;
    one_liner: string;
  }[] = [];
  const failed: { id: string; reason: string }[] = [];

  for (let c = 0; c < targets.length; c += CHUNK) {
    const chunk = targets.slice(c, c + CHUNK);
    // 비전 메시지: 각 이미지 앞에 [이미지 N] 파일명 텍스트 → 이미지 블록
    const content: Anthropic.ContentBlockParam[] = [];
    chunk.forEach((img, i) => {
      const fname = img.source_filename ?? allowed.get(img.id) ?? "(파일명 없음)";
      content.push({ type: "text", text: `[이미지 ${i}] 파일명: ${fname}` });
      content.push({ type: "image", source: { type: "url", url: img.url } });
    });
    content.push({
      type: "text",
      text: "위 이미지 각각에 대해 index(0부터), zone_guess, aspect_guess, one_liner를 반환하라.",
    });

    try {
      const response = await anthropic.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 8000,
        thinking: { type: "adaptive" },
        system,
        messages: [{ role: "user", content }],
        output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
      });
      const textBlock = response.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") throw new Error("응답에 결과가 없습니다.");
      const parsed = JSON.parse(textBlock.text) as { results: ClassifyResult[] };
      const byIndex = new Map(parsed.results.map((r) => [r.index, r]));

      chunk.forEach((img, i) => {
        const r = byIndex.get(i);
        if (!r) {
          failed.push({ id: img.id, reason: "AI 응답에 결과 누락" });
          return;
        }
        // 허용값 밖이면 null 처리 (환각 방지)
        const zone = r.zone_guess && validZones.has(r.zone_guess) ? r.zone_guess : null;
        const aspect = r.aspect_guess && validAspects.has(r.aspect_guess) ? r.aspect_guess : null;
        classified.push({
          id: img.id,
          zone_guess: zone,
          aspect_guess: aspect,
          one_liner: r.one_liner,
        });
      });
    } catch (e) {
      // 이 청크 전체 실패 → pending 유지
      chunk.forEach((img) => failed.push({ id: img.id, reason: (e as Error).message }));
    }
  }

  // ----- 저장 (user 세션 — RLS로 편집 권한 강제) -----
  const stored: string[] = [];
  for (const r of classified) {
    const { error } = await supabase
      .from("ref_images")
      .update({ ai_zone_guess: r.zone_guess, ai_aspect_guess: r.aspect_guess })
      .eq("id", r.id);
    if (error) failed.push({ id: r.id, reason: "저장 실패: " + error.message });
    else stored.push(r.id);
  }

  await supabase.from("events").insert({
    actor_id: user.id,
    board_id: boardId,
    type: "ref.ai_classified",
    payload: { total: targets.length, classified: stored.length, failed: failed.length },
  });

  return NextResponse.json({
    board_id: boardId,
    classified: stored.length,
    failed,
    results: classified.filter((r) => stored.includes(r.id)),
  });
}
