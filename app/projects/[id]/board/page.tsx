import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/** 스펙 6.6 URL 유지 — 프로젝트 보드로 리다이렉트 */
export default async function ProjectBoardRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("boards")
    .select("id")
    .eq("kind", "project")
    .eq("project_id", id)
    .single();

  if (!data) notFound();
  redirect(`/boards/${data.id}`);
}
