import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@/lib/supabase/server";

/**
 * AI 일정 반영 1단계 — 자료 해석 (스펙 확장 2026-07-08, director 전용).
 * 대표가 붙여넣은 자료(회의록·메시지·이메일 등)를 Claude가 현재 팀·프로젝트·
 * 태스크 컨텍스트에 근거해 "변경안 항목"으로 구조화 → ai_change_sets/items 저장.
 * 실제 반영은 당사자 확인(ack) → 대표 최종 컨펌 후 별도로 이뤄진다.
 */

export const maxDuration = 120;

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "items", "notes"],
  properties: {
    summary: { type: "string", description: "자료 전체를 한두 문장으로 요약 (한국어)" },
    notes: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "해석이 불확실했거나 컨텍스트에 없는 인원·프로젝트가 언급된 경우 설명",
    },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["action", "task_id", "project_id", "assignee_id", "summary", "fields"],
        properties: {
          action: { enum: ["create", "update", "delete"] },
          task_id: {
            anyOf: [{ type: "string" }, { type: "null" }],
            description: "update/delete 시 대상 태스크 id (컨텍스트의 id만)",
          },
          project_id: {
            anyOf: [{ type: "string" }, { type: "null" }],
            description: "create 시 필수 (컨텍스트의 id만)",
          },
          assignee_id: {
            anyOf: [{ type: "string" }, { type: "null" }],
            description: "이 변경의 당사자(확인 요청을 받을 사람) — 컨텍스트의 id만",
          },
          summary: { type: "string", description: "당사자가 읽을 한 줄 설명 (한국어)" },
          fields: {
            type: "object",
            additionalProperties: false,
            description: "create: 전체 값 / update: 바뀌는 값만 / delete: 빈 객체",
            properties: {
              name: { anyOf: [{ type: "string" }, { type: "null" }] },
              description: { anyOf: [{ type: "string" }, { type: "null" }] },
              start_date: {
                anyOf: [{ type: "string" }, { type: "null" }],
                description: "YYYY-MM-DD",
              },
              end_date: {
                anyOf: [{ type: "string" }, { type: "null" }],
                description: "YYYY-MM-DD",
              },
              status: { anyOf: [{ enum: ["wait", "active", "done"] }, { type: "null" }] },
              assignee_id: {
                anyOf: [{ type: "string" }, { type: "null" }],
                description: "담당자 변경 시에만",
              },
            },
          },
        },
      },
    },
  },
} as const;

type ParsedItem = {
  action: "create" | "update" | "delete";
  task_id: string | null;
  project_id: string | null;
  assignee_id: string | null;
  summary: string;
  fields: Record<string, string | null>;
};

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });

  const { data: me } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (me?.role !== "director")
    return NextResponse.json({ error: "대표만 사용할 수 있습니다." }, { status: 403 });

  if (!process.env.ANTHROPIC_API_KEY)
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY가 설정되지 않았습니다. .env.local에 추가 후 서버를 재시작해주세요." },
      { status: 500 },
    );

  const { text } = (await req.json()) as { text?: string };
  if (!text?.trim())
    return NextResponse.json({ error: "해석할 자료를 입력해주세요." }, { status: 400 });

  // ----- 현재 상태 컨텍스트 (director 세션 — RLS로 전체 조회) -----
  const [team, projects, tasks] = await Promise.all([
    supabase.rpc("team_directory"),
    supabase.from("projects").select("id, code, name"),
    supabase
      .from("tasks")
      .select("id, project_id, name, assignee_id, start_date, end_date, status"),
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const context = {
    today,
    team: (team.data ?? []).map((t) => ({ id: t.id, name: t.name, role: t.role })),
    projects: projects.data ?? [],
    tasks: tasks.data ?? [],
  };

  const system = `너는 디자인 스튜디오 "오디티하우스"의 일정 관리 어시스턴트다.
대표가 붙여넣은 자료(회의록, 메신저 대화, 이메일, 메모 등)를 읽고, 현재 일정 데이터에
가해야 할 변경안을 구조화해서 반환한다.

규칙:
- id(태스크·프로젝트·인원)는 반드시 컨텍스트에 있는 것만 사용한다. 추측으로 만들지 않는다.
- 자료에 언급됐지만 컨텍스트에 없는 인원·프로젝트는 변경안을 만들지 말고 notes에 적는다.
- 날짜는 YYYY-MM-DD. "다음주 화요일" 같은 상대 표현은 today(${today}, 주 시작은 월요일) 기준으로 환산한다.
- update/delete는 task_id 필수. create는 project_id와 fields.name, start_date, end_date 필수.
- 각 항목의 assignee_id는 그 변경의 당사자(확인 요청을 받을 사람)다. create/update는 담당자,
  delete는 기존 담당자를 넣는다.
- summary는 당사자가 읽고 "내 일정이 이렇게 바뀐다"를 바로 이해할 수 있는 한국어 한 문장.
- 확실한 변경만 항목으로 만든다. 애매하면 notes에 적고 항목은 만들지 않는다.`;

  const anthropic = new Anthropic();
  let parsed: { summary: string; notes: string | null; items: ParsedItem[] };
  try {
    const response = await anthropic.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system,
      messages: [
        {
          role: "user",
          content: `## 현재 일정 데이터\n${JSON.stringify(context)}\n\n## 자료\n${text}`,
        },
      ],
      output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    });
    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") throw new Error("응답에 결과가 없습니다.");
    parsed = JSON.parse(textBlock.text);
  } catch (e) {
    return NextResponse.json(
      { error: "AI 해석 실패: " + (e as Error).message },
      { status: 502 },
    );
  }

  // ----- 서버측 검증: 존재하지 않는 id 참조 항목은 제외하고 notes에 기록 -----
  const taskById = new Map((tasks.data ?? []).map((t) => [t.id, t]));
  const projectIds = new Set((projects.data ?? []).map((p) => p.id));
  const teamIds = new Set((team.data ?? []).map((t) => t.id));
  const dropped: string[] = [];
  const valid = (parsed.items ?? []).filter((it) => {
    if ((it.action === "update" || it.action === "delete") && !taskById.has(it.task_id ?? ""))
      return dropped.push(it.summary), false;
    if (it.action === "create" && (!projectIds.has(it.project_id ?? "") || !it.fields?.name))
      return dropped.push(it.summary), false;
    if (it.assignee_id && !teamIds.has(it.assignee_id)) it.assignee_id = null;
    return true;
  });

  if (valid.length === 0)
    return NextResponse.json(
      { error: "반영할 수 있는 변경안이 없습니다." + (parsed.notes ? ` (참고: ${parsed.notes})` : "") },
      { status: 422 },
    );

  const notes =
    [parsed.notes, dropped.length ? `검증에서 제외됨: ${dropped.join(" / ")}` : null]
      .filter(Boolean)
      .join("\n") || null;

  // ----- 저장 -----
  const { data: set, error: setErr } = await supabase
    .from("ai_change_sets")
    .insert({ created_by: user.id, source_text: text, summary: parsed.summary, notes })
    .select()
    .single();
  if (setErr) return NextResponse.json({ error: setErr.message }, { status: 500 });

  const rows = valid.map((it, i) => {
    const beforeTask = it.task_id ? taskById.get(it.task_id) : null;
    return {
      set_id: set.id,
      seq: i,
      action: it.action,
      task_id: it.task_id,
      project_id: it.project_id ?? beforeTask?.project_id ?? null,
      assignee_id: it.assignee_id,
      summary: it.summary,
      payload: it.fields ?? {},
      before: beforeTask ?? null,
    };
  });
  const { error: itemErr } = await supabase.from("ai_change_items").insert(rows);
  if (itemErr) {
    await supabase.from("ai_change_sets").delete().eq("id", set.id);
    return NextResponse.json({ error: itemErr.message }, { status: 500 });
  }

  await supabase.from("events").insert({
    actor_id: user.id,
    type: "ai.proposed",
    payload: { set_id: set.id, items: rows.length, summary: parsed.summary },
  });

  return NextResponse.json({ set_id: set.id, items: rows.length, summary: parsed.summary });
}
