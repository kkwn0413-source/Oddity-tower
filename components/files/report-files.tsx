"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { fmtMD, parseDate } from "@/lib/dates";

/**
 * 보고 파일 모아보기.
 * - 승인(approved)된 파일만 — 업체 → 프로젝트 그룹, 업체 필터 칩.
 * - 이미지는 signed URL 썸네일로 바로 보고, 클릭하면 라이트박스.
 * - 그 외 파일·링크는 새 탭. director는 "보고 제외"로 즉시 내릴 수 있다.
 */

type FileRow = {
  id: string;
  task_id: string;
  uploader_id: string;
  kind: "upload" | "drive" | "figma";
  name: string;
  url: string; // upload = storage 경로
  version: number;
  created_at: string;
};

type TaskRef = { id: string; name: string; project_id: string };
type ProjectRef = { id: string; code: string; name: string; client_id: string };
type ClientRef = { id: string; name: string };
type Member = { id: string; name: string; color: string };

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|avif)$/i;

export function ReportFiles({
  files,
  tasks,
  projects,
  clients,
  team,
  isDirector,
  meId,
}: {
  files: FileRow[];
  tasks: TaskRef[];
  projects: ProjectRef[];
  clients: ClientRef[];
  team: Member[];
  isDirector: boolean;
  meId: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [clientFilter, setClientFilter] = useState<string | null>(null);
  const [signed, setSigned] = useState<Record<string, string>>({}); // file.id → signed URL
  const [lightbox, setLightbox] = useState<FileRow | null>(null);

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const projectById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const nameOf = (id: string) => team.find((t) => t.id === id)?.name ?? "?";

  const projectOf = useCallback(
    (f: FileRow) => projectById.get(taskById.get(f.task_id)?.project_id ?? ""),
    [projectById, taskById],
  );

  // 업로드 파일 전체의 signed URL을 한 번에 발급 (1시간)
  useEffect(() => {
    const uploads = files.filter((f) => f.kind === "upload");
    if (uploads.length === 0) return;
    void supabase.storage
      .from("task-files")
      .createSignedUrls(
        uploads.map((f) => f.url),
        3600,
      )
      .then(({ data }) => {
        if (!data) return;
        const map: Record<string, string> = {};
        uploads.forEach((f, i) => {
          if (data[i]?.signedUrl) map[f.id] = data[i].signedUrl;
        });
        setSigned(map);
      });
  }, [supabase, files]);

  async function unapprove(f: FileRow) {
    if (!window.confirm(`"${f.name}"을(를) 보고 파일에서 제외할까요? (파일은 태스크에 그대로 남습니다)`)) return;
    const { error } = await supabase.from("task_files").update({ approved: false }).eq("id", f.id);
    if (error) return alert("제외 실패: " + error.message);
    supabase
      .from("events")
      .insert({ actor_id: meId, task_id: f.task_id, type: "file.approved", payload: { name: f.name, before: true, after: false } })
      .then(({ error: e }) => e && console.warn("이벤트 기록 실패:", e.message));
    router.refresh();
  }

  function open(f: FileRow) {
    if (f.kind !== "upload") return window.open(f.url, "_blank", "noopener");
    const u = signed[f.id];
    if (!u) return;
    if (IMAGE_EXT.test(f.name)) setLightbox(f);
    else window.open(u, "_blank", "noopener");
  }

  // 필터 → 업체별 그룹
  const visible = files.filter((f) => {
    const p = projectOf(f);
    return p && (!clientFilter || p.client_id === clientFilter);
  });
  const groups = clients
    .map((c) => ({
      client: c,
      projects: projects
        .filter((p) => p.client_id === c.id)
        .map((p) => ({
          project: p,
          files: visible.filter((f) => projectOf(f)?.id === p.id),
        }))
        .filter((g) => g.files.length > 0),
    }))
    .filter((g) => g.projects.length > 0 && (!clientFilter || g.client.id === clientFilter));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-navy">보고 파일</h1>
        <span className="text-xs text-navy/45">
          업체 보고용으로 승인된 파일만 모아 보여줍니다. 승인은 태스크 패널의 파일 섹션에서.
        </span>
      </div>

      {/* 업체 필터 */}
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-card p-2 shadow-sm">
        <button
          onClick={() => setClientFilter(null)}
          className={
            "rounded-md px-2.5 py-1 text-xs font-medium " +
            (!clientFilter ? "bg-navy text-white" : "text-navy/50 hover:bg-navy/5")
          }
        >
          전체 업체
        </button>
        {clients.map((c) => (
          <button
            key={c.id}
            onClick={() => setClientFilter(c.id)}
            className={
              "rounded-md px-2.5 py-1 text-xs font-medium " +
              (clientFilter === c.id ? "bg-navy text-white" : "text-navy/50 hover:bg-navy/5")
            }
          >
            {c.name}
          </button>
        ))}
        <span className="ml-auto pr-2 text-xs tabular-nums text-navy/45">{visible.length}개 파일</span>
      </div>

      {/* 업체 → 프로젝트 그룹 */}
      {groups.map(({ client, projects: pgroups }) => (
        <section key={client.id}>
          <h2 className="text-[11px] font-bold uppercase tracking-wider text-navy/45">{client.name}</h2>
          {pgroups.map(({ project, files: pfiles }) => (
            <div key={project.id} className="mt-2 rounded-xl bg-card p-4 shadow-sm">
              <div className="flex items-center gap-2">
                <span className="rounded bg-navy/8 px-1.5 py-0.5 text-[10px] font-bold text-navy/55">{project.code}</span>
                <span className="text-[13px] font-semibold text-navy">{project.name}</span>
                <span className="text-[11px] text-navy/35">{pfiles.length}개</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {pfiles.map((f) => {
                  const isImage = f.kind === "upload" && IMAGE_EXT.test(f.name);
                  const task = taskById.get(f.task_id);
                  return (
                    <div key={f.id} className="group overflow-hidden rounded-lg border border-navy/10 bg-bg/50">
                      <button onClick={() => open(f)} className="block w-full text-left" title={f.name}>
                        {isImage && signed[f.id] ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={signed[f.id]} alt={f.name} className="h-32 w-full object-cover" />
                        ) : (
                          <div className="flex h-32 w-full flex-col items-center justify-center gap-1 text-navy/35">
                            <span className="text-2xl">{f.kind === "figma" ? "◇" : f.kind === "drive" ? "▲" : "📄"}</span>
                            <span className="text-[10px] font-bold uppercase">
                              {f.kind === "upload" ? (f.name.split(".").pop() ?? "file") : f.kind}
                            </span>
                          </div>
                        )}
                      </button>
                      <div className="px-2.5 py-2">
                        <p className="truncate text-[11px] font-medium text-navy/80" title={f.name}>{f.name}</p>
                        <p className="mt-0.5 flex items-center gap-1 text-[10px] text-navy/40">
                          <span className="truncate">{task?.name}</span>
                          <span className="ml-auto shrink-0">{nameOf(f.uploader_id)} · {fmtMD(parseDate(f.created_at.slice(0, 10)))}</span>
                        </p>
                        {isDirector && (
                          <button
                            onClick={() => unapprove(f)}
                            className="mt-1 rounded px-1 py-0.5 text-[10px] text-navy/35 hover:text-danger"
                          >
                            보고 제외
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </section>
      ))}
      {groups.length === 0 && (
        <p className="rounded-xl border border-dashed border-navy/15 px-4 py-10 text-center text-sm text-navy/35">
          승인된 보고 파일이 없습니다. 태스크 패널에서 파일을 승인하면 여기에 모입니다.
        </p>
      )}

      {/* 라이트박스 */}
      {lightbox && signed[lightbox.id] && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-navy/80 p-6"
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={signed[lightbox.id]} alt={lightbox.name} className="max-h-full max-w-full rounded-lg shadow-2xl" />
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-navy/90 px-4 py-1.5 text-xs text-white">
            {lightbox.name} — 클릭해서 닫기
          </div>
        </div>
      )}
    </div>
  );
}
