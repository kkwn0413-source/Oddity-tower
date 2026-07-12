import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { TriageFlow } from "@/components/board/triage-flow";
import type { Annotation } from "@/lib/triage";

/**
 * 레퍼런스 정리(트리아지) 카드 화면 (BRIEF Phase 4).
 * 목업 정본: reference/triage-mockup-v2.html
 *
 * 설계 전환(2026-07-13): 존(공간/기물)은 업로드 시 지정된 1차 라벨이므로,
 * 카드의 존 기본값은 ai_zone_guess가 아니라 이미지의 현재 zone_id.
 * AI 추정 줄은 ai_zone_guess가 있을 때만(대량 덤프 비전 보조) 표시.
 */
export default async function TriagePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: board } = await supabase
    .from("boards")
    .select("id, title, kind, project_id, owner_id")
    .eq("id", id)
    .single();
  if (!board) notFound();

  // 편집 권한 확인 (RLS와 동일 규칙)
  const isDirector = profile.role === "director";
  let canEdit = isDirector || board.kind === "shared";
  if (!canEdit && board.kind === "personal") canEdit = board.owner_id === profile.id;
  if (!canEdit && board.kind === "project" && board.project_id) {
    const { data: myTask } = await supabase
      .from("tasks")
      .select("id")
      .eq("project_id", board.project_id)
      .eq("assignee_id", profile.id)
      .limit(1);
    canEdit = (myTask ?? []).length > 0;
  }
  if (!canEdit) redirect(`/boards/${id}`);

  const { data: zones } = await supabase
    .from("ref_zones")
    .select("id, title, kind, sort_order")
    .eq("board_id", id)
    .order("sort_order");
  const zoneIds = (zones ?? []).map((z) => z.id);

  const { data: rawImages } = zoneIds.length
    ? await supabase
        .from("ref_images")
        .select(
          "id, zone_id, kind, url, filename, source_filename, ai_zone_guess, ai_aspect_guess, aspect, annotation, doc_group, triage_status, sort_order",
        )
        .in("zone_id", zoneIds)
        .eq("triage_status", "pending")
        .eq("hidden", false)
        .order("sort_order")
    : { data: [] };

  // upload 이미지 signed URL 변환
  const uploadPaths = (rawImages ?? [])
    .filter((i) => i.kind === "upload")
    .map((i) => i.url);
  const signed = new Map<string, string>();
  if (uploadPaths.length > 0) {
    const { data } = await supabase.storage
      .from("ref-images")
      .createSignedUrls(uploadPaths, 3600);
    for (const s of data ?? []) if (s.signedUrl && s.path) signed.set(s.path, s.signedUrl);
  }

  // 존 sort_order 기준으로 이미지 정렬 (존 단위로 순회)
  const zoneOrder = new Map((zones ?? []).map((z) => [z.id, z.sort_order]));
  const images = (rawImages ?? [])
    .map((i) => ({
      id: i.id,
      zone_id: i.zone_id,
      src: i.kind === "upload" ? (signed.get(i.url) ?? "") : i.url,
      source_filename: i.source_filename,
      ai_zone_guess: i.ai_zone_guess,
      ai_aspect_guess: i.ai_aspect_guess,
      aspect: i.aspect,
      annotation: (i.annotation as Annotation | null) ?? null,
      doc_group: i.doc_group,
    }))
    .sort(
      (a, b) =>
        (zoneOrder.get(a.zone_id) ?? 0) - (zoneOrder.get(b.zone_id) ?? 0),
    );

  return (
    <TriageFlow
      boardId={id}
      boardTitle={board.title}
      zones={zones ?? []}
      images={images}
      meId={profile.id}
    />
  );
}
