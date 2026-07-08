"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { fmtMD, parseDate } from "@/lib/dates";

/**
 * 태스크 파일 섹션 (스펙 6단계).
 * - 업로드: 버킷 task-files(private), 경로 {task_id}/{uuid}.{ext}.
 *   표시 이름은 자동 네이밍 {code}_{task slug}_{작업자명}_v{NN}.{ext} — DB name에 보관,
 *   재업로드 시 version+1. 다운로드는 signed URL 1h(download=표시 이름).
 * - Drive/Figma: 외부 링크 저장 (kind 자동 판별).
 * - approved 토글·삭제: director 전용 (RLS도 동일하게 차단).
 */

type TaskFile = {
  id: string;
  uploader_id: string;
  kind: "upload" | "drive" | "figma";
  name: string;
  url: string; // upload = storage 경로, drive/figma = 외부 URL
  version: number;
  approved: boolean;
  created_at: string;
};

const KIND_LABEL: Record<TaskFile["kind"], string> = {
  upload: "파일",
  drive: "Drive",
  figma: "Figma",
};

/** 파일명에 못 쓰는 문자 제거 + 공백 → 하이픈 (한글 유지) */
function slugify(s: string) {
  return s
    .trim()
    .replace(/[\\/:*?"<>|#%&{}]+/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 40);
}

export function TaskFiles({
  taskId,
  projectId,
  projectCode,
  taskName,
  meId,
  meName,
  isDirector,
  nameOf,
}: {
  taskId: string;
  projectId: string;
  projectCode: string;
  taskName: string;
  meId: string;
  meName: string;
  isDirector: boolean;
  nameOf: (id: string | null) => string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [files, setFiles] = useState<TaskFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from("task_files")
      .select("id, uploader_id, kind, name, url, version, approved, created_at")
      .eq("task_id", taskId)
      .order("created_at", { ascending: false });
    setFiles((data ?? []) as TaskFile[]);
  }, [supabase, taskId]);

  useEffect(() => {
    void load();
  }, [load]);

  function logEvent(type: string, payload: Record<string, string | number | boolean | null>) {
    supabase
      .from("events")
      .insert({ actor_id: meId, project_id: projectId, task_id: taskId, type, payload })
      .then(({ error }) => error && console.warn("이벤트 기록 실패:", error.message));
  }

  // ----- 업로드 (자동 네이밍 + version+1) -----
  async function onFilesChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const chosen = [...(e.target.files ?? [])];
    e.target.value = "";
    if (chosen.length === 0) return;
    setBusy(true);
    try {
      let version = Math.max(0, ...files.filter((f) => f.kind === "upload").map((f) => f.version));
      for (const f of chosen) {
        version += 1;
        const ext = (f.name.split(".").pop() ?? "bin").toLowerCase();
        const displayName = `${projectCode}_${slugify(taskName)}_${meName}_v${String(version).padStart(2, "0")}.${ext}`;
        const path = `${taskId}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("task-files")
          .upload(path, f, { contentType: f.type });
        if (upErr) throw new Error(upErr.message);
        const { error: insErr } = await supabase.from("task_files").insert({
          task_id: taskId,
          uploader_id: meId,
          kind: "upload",
          name: displayName,
          url: path,
          version,
        });
        if (insErr) throw new Error(insErr.message);
        logEvent("file.uploaded", { name: displayName, version });
      }
      await load();
    } catch (err) {
      alert("업로드 실패: " + (err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // ----- 다운로드: signed URL 1h -----
  async function download(f: TaskFile) {
    if (f.kind !== "upload") {
      window.open(f.url, "_blank", "noopener");
      return;
    }
    const { data, error } = await supabase.storage
      .from("task-files")
      .createSignedUrl(f.url, 3600, { download: f.name });
    if (error || !data) {
      alert("링크 생성 실패: " + (error?.message ?? ""));
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener");
  }

  // ----- Drive/Figma 링크 -----
  async function addLink() {
    const url = linkUrl.trim();
    if (!/^https?:\/\//.test(url)) {
      alert("http(s):// 로 시작하는 URL을 입력해주세요.");
      return;
    }
    let host = "";
    try {
      host = new URL(url).hostname;
    } catch {
      alert("URL 형식이 올바르지 않습니다.");
      return;
    }
    const kind: TaskFile["kind"] = /figma\.com$/.test(host) ? "figma" : "drive";
    setBusy(true);
    const { error } = await supabase.from("task_files").insert({
      task_id: taskId,
      uploader_id: meId,
      kind,
      name: host.replace(/^www\./, ""),
      url,
      version: 1,
    });
    setBusy(false);
    if (error) {
      alert("링크 저장 실패: " + error.message);
      return;
    }
    logEvent("file.link_added", { kind, url });
    setLinkUrl("");
    setLinkOpen(false);
    await load();
  }

  // ----- approved 토글 / 삭제 (director) -----
  async function toggleApproved(f: TaskFile) {
    const { error } = await supabase
      .from("task_files")
      .update({ approved: !f.approved })
      .eq("id", f.id);
    if (error) {
      alert("변경 실패: " + error.message);
      return;
    }
    logEvent("file.approved", { name: f.name, before: f.approved, after: !f.approved });
    setFiles((prev) => prev.map((x) => (x.id === f.id ? { ...x, approved: !x.approved } : x)));
  }

  async function removeFile(f: TaskFile) {
    if (!window.confirm(`"${f.name}" 파일을 삭제할까요?`)) return;
    const { error } = await supabase.from("task_files").delete().eq("id", f.id);
    if (error) {
      alert("삭제 실패: " + error.message);
      return;
    }
    if (f.kind === "upload") void supabase.storage.from("task-files").remove([f.url]);
    logEvent("file.removed", { name: f.name });
    setFiles((prev) => prev.filter((x) => x.id !== f.id));
  }

  // ---------------------------------------------------------------------------
  const input =
    "w-full rounded-md border border-navy/15 bg-white px-2.5 py-1.5 text-sm text-navy outline-none focus:border-gold focus:ring-1 focus:ring-gold/25";

  return (
    <div className="mt-1.5 flex flex-col gap-2">
      {files.map((f) => (
        <div key={f.id} className="flex items-center gap-2 rounded-lg bg-bg/70 px-3 py-2">
          <span
            className={
              "shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold " +
              (f.kind === "upload" ? "bg-navy/10 text-navy/60" : "bg-gold/15 text-gold")
            }
          >
            {KIND_LABEL[f.kind]}
          </span>
          <button
            onClick={() => download(f)}
            className="min-w-0 flex-1 truncate text-left text-[13px] text-navy/85 underline-offset-2 hover:underline"
            title={f.kind === "upload" ? "다운로드 (1시간 링크)" : f.url}
          >
            {f.name}
          </button>
          <span className="shrink-0 text-[10px] text-navy/40">
            {nameOf(f.uploader_id)} · {fmtMD(parseDate(f.created_at.slice(0, 10)))}
          </span>
          {isDirector && (
            <>
              <button
                onClick={() => toggleApproved(f)}
                className={
                  "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold " +
                  (f.approved
                    ? "bg-gold text-white"
                    : "bg-navy/5 text-navy/35 hover:text-navy/60")
                }
                title={f.approved ? "공유 링크에 노출 중 — 클릭해서 해제" : "승인하면 공유 링크에 노출됩니다"}
              >
                {f.approved ? "승인됨" : "승인"}
              </button>
              <button
                onClick={() => removeFile(f)}
                className="shrink-0 rounded px-1 text-xs text-navy/30 hover:text-danger"
                aria-label="삭제"
              >
                ✕
              </button>
            </>
          )}
        </div>
      ))}
      {files.length === 0 && <p className="text-xs text-navy/35">아직 파일이 없습니다.</p>}

      <div className="flex items-center gap-2">
        <button
          onClick={() => fileInput.current?.click()}
          disabled={busy}
          className="rounded-md bg-navy px-3.5 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {busy ? "처리 중..." : "파일 업로드"}
        </button>
        <button
          onClick={() => setLinkOpen((v) => !v)}
          className="rounded-md border border-navy/15 px-3.5 py-1.5 text-xs font-medium text-navy/60 hover:text-navy"
        >
          Drive/Figma 링크
        </button>
        <input ref={fileInput} type="file" multiple hidden onChange={onFilesChosen} />
      </div>

      {linkOpen && (
        <div className="flex gap-1.5">
          <input
            className={input}
            placeholder="https://drive.google.com/... 또는 figma.com/..."
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addLink()}
          />
          <button
            onClick={addLink}
            disabled={busy}
            className="shrink-0 rounded-md bg-navy px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            추가
          </button>
        </div>
      )}
    </div>
  );
}
