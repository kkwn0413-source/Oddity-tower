import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { BoardView } from "@/components/board/board-view";
import type { BoardData, BoardImage } from "@/components/board/types";

export default async function BoardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: board } = await supabase
    .from("boards")
    .select("*")
    .eq("id", id)
    .single();
  if (!board) notFound();

  const [
    { data: zones },
    { data: meetings },
    { data: assets },
    { data: team },
    projectInfo,
  ] = await Promise.all([
    supabase
      .from("ref_zones")
      .select("id, title, sort_order, batch_label")
      .eq("board_id", id)
      .order("sort_order"),
    supabase
      .from("meetings")
      .select(
        "id, round, title, met_at, body, author_id, updated_at, meeting_items(id, kind, body, sort_order), meeting_comments(id, author_id, body, resolved, created_at), meeting_revisions(id)",
      )
      .eq("board_id", id)
      .order("round", { ascending: false }),
    supabase
      .from("board_assets")
      .select("id, name, url, sort_order")
      .eq("board_id", id)
      .order("sort_order"),
    supabase.rpc("team_directory"),
    board.project_id
      ? supabase
          .from("projects")
          .select("code")
          .eq("id", board.project_id)
          .single()
      : Promise.resolve({ data: null }),
  ]);

  const zoneIds = (zones ?? []).map((z) => z.id);
  const { data: rawImages } = zoneIds.length
    ? await supabase
        .from("ref_images")
        .select("*")
        .in("zone_id", zoneIds)
        .order("sort_order")
    : { data: [] };

  // 방향 로그: 프로젝트 보드에만 (스펙 — 프로젝트 의사결정 기록)
  const { data: directionLogs } = board.project_id
    ? await supabase
        .from("direction_logs")
        .select("id, author_id, body, status, supersedes, created_at")
        .eq("project_id", board.project_id)
        .order("created_at", { ascending: false })
    : { data: [] };

  // upload 이미지는 signed URL로 변환 (1시간)
  const images: BoardImage[] = [];
  const uploadPaths = (rawImages ?? [])
    .filter((i) => i.kind === "upload")
    .map((i) => i.url);
  const signedMap = new Map<string, string>();
  if (uploadPaths.length > 0) {
    const { data: signed } = await supabase.storage
      .from("ref-images")
      .createSignedUrls(uploadPaths, 3600);
    for (const s of signed ?? []) {
      if (s.signedUrl && s.path) signedMap.set(s.path, s.signedUrl);
    }
  }
  for (const i of rawImages ?? []) {
    images.push({
      id: i.id,
      zone_id: i.zone_id,
      uploader_id: i.uploader_id,
      kind: i.kind,
      src: i.kind === "upload" ? (signedMap.get(i.url) ?? "") : i.url,
      filename: i.filename,
      starred: i.starred,
      hidden: i.hidden,
      memo: i.memo,
      verdict: (i.verdict as "good" | "bad" | null) ?? null,
      verdict_memo: i.verdict_memo,
      verdict_by: i.verdict_by,
      verdict_at: i.verdict_at,
      doc_group: i.doc_group,
      sort_order: i.sort_order,
    });
  }

  // 접근 제한 멤버 목록 (RLS: director는 전체, 그 외엔 본인 row만 — UI는 director 전용)
  const { data: members } = await supabase
    .from("board_members")
    .select("user_id")
    .eq("board_id", id);

  const data: BoardData = {
    board: {
      id: board.id,
      kind: board.kind,
      project_id: board.project_id,
      owner_id: board.owner_id,
      title: board.title,
      shared: board.shared,
      access: board.access,
      memberIds: (members ?? []).map((m) => m.user_id),
      projectCode: projectInfo.data?.code ?? null,
    },
    zones: zones ?? [],
    images,
    meetings: (meetings ?? []).map((m) => ({
      id: m.id,
      round: m.round,
      title: m.title,
      met_at: m.met_at,
      body: m.body,
      author_id: m.author_id,
      updated_at: m.updated_at,
      items: (m.meeting_items ?? []).sort((a, b) => a.sort_order - b.sort_order),
      comments: (m.meeting_comments ?? []).sort((a, b) =>
        a.created_at.localeCompare(b.created_at),
      ),
      revisionCount: (m.meeting_revisions ?? []).length,
    })),
    directionLogs: directionLogs ?? [],
    assets: assets ?? [],
    team: (team ?? []) as BoardData["team"],
  };

  // 편집 권한 (RLS와 동일 규칙 — UI 노출 판단용)
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
  const canDelete =
    isDirector ||
    board.kind === "shared" ||
    (board.kind === "personal" && board.owner_id === profile.id);

  return (
    <BoardView
      data={data}
      meId={profile.id}
      isDirector={isDirector}
      canEdit={canEdit}
      canDelete={canDelete}
    />
  );
}
