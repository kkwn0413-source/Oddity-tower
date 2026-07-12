"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
// DEFERRED: BRIEF Phase 1 — 회의 모듈 숨김. 복원 시 import·구조분해·탭·패널 주석 해제
// import { MeetingsPanel } from "./meetings-panel";
import { DirectionPanel } from "./direction-panel";
import type { BoardData, BoardImage, BoardZone, ScheduleInfo } from "./types";

/**
 * 레퍼런스 보드 — v17 다크 UX 계승.
 * 7b: 조회(마소너리·존 네비·라이트박스·doc 스트립·판정 모아보기)
 * 7c: 편집 모드(★/숨김/메모/삭제, 업로드+URL 추가, 존 관리)
 * 7d: 디렉팅 판정 (director 전용, 이유 필수 — set_verdict RPC)
 */

type ViewMode = "all" | "stars" | "verdict";

// DEFERRED: BRIEF Phase 1 — 회의록 요약에서 쓰던 헬퍼. 복원 시 사용.
// function fmtDate(iso: string) {
//   const [y, m, d] = iso.slice(0, 10).split("-");
//   return `${y.slice(2)}.${m}.${d}`;
// }

export function BoardView({
  data,
  meId,
  isDirector,
  canEdit,
  canDelete,
  schedule,
}: {
  data: BoardData;
  meId: string;
  isDirector: boolean;
  canEdit: boolean;
  canDelete: boolean;
  schedule?: ScheduleInfo | null;
}) {
  // DEFERRED: BRIEF Phase 1 — meetings는 숨김(복원 시 구조분해에 추가)
  const { board, directionLogs, team } = data;
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();

  // 로컬 상태 (낙관적 갱신)
  const [zones, setZones] = useState<BoardZone[]>(data.zones);
  const [images, setImages] = useState<BoardImage[]>(data.images);
  const [assets, setAssets] = useState(data.assets);
  const [isShared, setIsShared] = useState(board.shared);
  const [mode, setMode] = useState<ViewMode>("all");
  const [editing, setEditing] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [lightbox, setLightbox] = useState<number | null>(null);
  // BRIEF Phase 1: 회의록 탭 숨김 → 기본 탭은 방향 로그(프로젝트 보드) 또는 파일 링크
  const [infoTab, setInfoTab] = useState<"meetings" | "logs" | "assets">(
    data.board.kind === "project" ? "logs" : "assets",
  );
  const [infoOpen, setInfoOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [accessOpen, setAccessOpen] = useState(false);
  const [access, setAccess] = useState<string>(board.access);
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set(board.memberIds));

  const fileInput = useRef<HTMLInputElement>(null);
  const uploadZone = useRef<string | null>(null);

  // 서버 refetch(router.refresh) 후 props 변화를 로컬 상태에 반영 — last-write-wins
  // (render 중 상태 조정 패턴 — effect 사용 시 cascading render)
  const [prevData, setPrevData] = useState(data);
  if (prevData !== data) {
    setPrevData(data);
    setZones(data.zones);
    setImages(data.images);
    setAssets(data.assets);
    setIsShared(board.shared);
    setAccess(board.access);
    setMemberIds(new Set(board.memberIds));
  }

  // Realtime — 이미지/존/링크/보드 설정 변경 시 서버 refetch (디바운스)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (t) clearTimeout(t);
      t = setTimeout(() => router.refresh(), 400);
    };
    const ch = supabase
      .channel(`board-${board.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ref_images" }, refresh)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ref_zones", filter: `board_id=eq.${board.id}` },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "board_assets", filter: `board_id=eq.${board.id}` },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "boards", filter: `id=eq.${board.id}` },
        refresh,
      )
      .subscribe();
    return () => {
      if (t) clearTimeout(t);
      void supabase.removeChannel(ch);
    };
  }, [supabase, board.id, router]);

  const nameOf = useMemo(() => {
    const m = new Map(team.map((t) => [t.id, t.name]));
    return (id: string | null) => (id ? (m.get(id) ?? "?") : "?");
  }, [team]);

  // ---------------------------------------------------------------------------
  // 이벤트 로그 헬퍼 (스펙 7장 — 모든 쓰기 경로)
  // ---------------------------------------------------------------------------
  const logEvent = useCallback(
    (type: string, payload: Record<string, string | number | boolean | null>) => {
      // 주의: supabase-js 쿼리는 .then 구독 시점에 실행된다 — void로 버리면 미실행
      supabase
        .from("events")
        .insert({
          actor_id: meId,
          board_id: board.id,
          project_id: board.project_id,
          type,
          payload,
        })
        .then(({ error }) => {
          if (error) console.warn("이벤트 기록 실패:", error.message);
        });
    },
    [supabase, meId, board.id, board.project_id],
  );

  // ---------------------------------------------------------------------------
  // 이미지 mutations
  // ---------------------------------------------------------------------------
  const patchImage = useCallback((id: string, patch: Partial<BoardImage>) => {
    setImages((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }, []);

  async function toggleStar(img: BoardImage) {
    patchImage(img.id, { starred: !img.starred });
    const { error } = await supabase
      .from("ref_images")
      .update({ starred: !img.starred })
      .eq("id", img.id);
    if (error) {
      patchImage(img.id, { starred: img.starred });
      alert("저장 실패: " + error.message);
    } else {
      logEvent("ref.starred", { image_id: img.id, starred: !img.starred });
    }
  }

  async function toggleHidden(img: BoardImage) {
    patchImage(img.id, { hidden: !img.hidden });
    const { error } = await supabase
      .from("ref_images")
      .update({ hidden: !img.hidden })
      .eq("id", img.id);
    if (error) {
      patchImage(img.id, { hidden: img.hidden });
      alert("저장 실패: " + error.message);
    }
  }

  async function editMemo(img: BoardImage) {
    const memo = window.prompt("이미지 메모", img.memo ?? "");
    if (memo === null) return;
    const value = memo.trim() === "" ? null : memo;
    patchImage(img.id, { memo: value });
    const { error } = await supabase
      .from("ref_images")
      .update({ memo: value })
      .eq("id", img.id);
    if (error) {
      patchImage(img.id, { memo: img.memo });
      alert("저장 실패: " + error.message);
    }
  }

  async function removeImage(img: BoardImage) {
    if (!window.confirm("이 이미지를 삭제할까요? (되돌릴 수 없음)")) return;
    setImages((prev) => prev.filter((i) => i.id !== img.id));
    const { error } = await supabase.from("ref_images").delete().eq("id", img.id);
    if (error) {
      setImages((prev) => [...prev, img]);
      alert("삭제 실패: " + error.message);
      return;
    }
    if (img.kind === "upload") {
      // storage path = DB의 url 원본 (src는 signed URL이므로 별도 보관 필요 없음 — 재조회로 해결)
      void supabase.storage.from("ref-images").remove([imgStoragePath(img)]);
    }
    logEvent("ref.image_removed", { image_id: img.id });
  }

  /** upload kind의 storage 경로 복원: signed URL에서 path 추출 */
  function imgStoragePath(img: BoardImage) {
    try {
      const u = new URL(img.src);
      const m = u.pathname.match(/\/object\/sign\/ref-images\/(.+)$/);
      return m ? decodeURIComponent(m[1]) : `${board.id}/${img.filename}`;
    } catch {
      return `${board.id}/${img.filename}`;
    }
  }

  // 판정 (7d — director 전용)
  async function setVerdict(img: BoardImage, verdict: "good" | "bad" | null) {
    let memo: string | null = null;
    if (verdict) {
      memo = window.prompt(
        `${verdict === "good" ? "● 좋음" : "● 나쁨"} 판정 이유 (필수 — 작업자에게 전달됩니다)`,
        img.verdict === verdict ? (img.verdict_memo ?? "") : "",
      );
      if (memo === null) return;
      if (memo.trim() === "") {
        alert("판정 이유는 필수입니다.");
        return;
      }
    }
    setBusy(img.id);
    const { error } = await supabase.rpc("set_verdict", {
      p_image_id: img.id,
      p_verdict: verdict as string,
      p_memo: memo ?? undefined,
    });
    setBusy(null);
    if (error) {
      alert("판정 실패: " + error.message);
      return;
    }
    patchImage(img.id, {
      verdict,
      verdict_memo: verdict ? memo : null,
      verdict_by: verdict ? meId : null,
      verdict_at: verdict ? new Date().toISOString() : null,
    });
  }

  // 추가: URL 붙여넣기
  async function addByUrl(zoneId: string) {
    const raw = window.prompt("이미지 URL (여러 개면 줄바꿈/공백 구분)");
    if (!raw) return;
    const urls = raw.split(/[\s\n]+/).filter((u) => /^https?:\/\//.test(u));
    if (urls.length === 0) return;
    const maxSort = Math.max(0, ...images.filter((i) => i.zone_id === zoneId).map((i) => i.sort_order));
    const rows = urls.map((url, k) => ({
      zone_id: zoneId,
      uploader_id: meId,
      kind: "url",
      url,
      sort_order: maxSort + k + 1,
    }));
    const { data: inserted, error } = await supabase
      .from("ref_images")
      .insert(rows)
      .select();
    if (error) {
      alert("추가 실패: " + error.message);
      return;
    }
    setImages((prev) => [
      ...prev,
      ...(inserted ?? []).map((i) => rowToImage(i, i.url)),
    ]);
    logEvent("ref.image_added", { zone_id: zoneId, count: urls.length, kind: "url" });
  }

  // 추가: 파일 업로드
  function pickFiles(zoneId: string) {
    uploadZone.current = zoneId;
    fileInput.current?.click();
  }

  async function onFilesChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(e.target.files ?? [])];
    e.target.value = "";
    const zoneId = uploadZone.current;
    if (!zoneId || files.length === 0) return;
    setBusy("upload");
    try {
      const maxSort = Math.max(0, ...images.filter((i) => i.zone_id === zoneId).map((i) => i.sort_order));
      let k = 0;
      for (const f of files) {
        const ext = (f.name.split(".").pop() ?? "bin").toLowerCase();
        const path = `${board.id}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from("ref-images")
          .upload(path, f, { contentType: f.type });
        if (upErr) throw new Error(upErr.message);
        const { data: inserted, error: insErr } = await supabase
          .from("ref_images")
          .insert({
            zone_id: zoneId,
            uploader_id: meId,
            kind: "upload",
            url: path,
            filename: f.name,
            sort_order: maxSort + ++k,
          })
          .select()
          .single();
        if (insErr) throw new Error(insErr.message);
        const { data: signed } = await supabase.storage
          .from("ref-images")
          .createSignedUrl(path, 3600);
        setImages((prev) => [...prev, rowToImage(inserted, signed?.signedUrl ?? "")]);
      }
      logEvent("ref.image_added", { zone_id: zoneId, count: files.length, kind: "upload" });
    } catch (err) {
      alert("업로드 실패: " + (err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function rowToImage(row: Record<string, unknown>, src: string): BoardImage {
    return {
      id: row.id as string,
      zone_id: row.zone_id as string,
      uploader_id: row.uploader_id as string,
      kind: row.kind as string,
      src,
      filename: (row.filename as string) ?? null,
      starred: !!row.starred,
      hidden: !!row.hidden,
      memo: (row.memo as string) ?? null,
      verdict: (row.verdict as "good" | "bad" | null) ?? null,
      verdict_memo: (row.verdict_memo as string) ?? null,
      verdict_by: (row.verdict_by as string) ?? null,
      verdict_at: (row.verdict_at as string) ?? null,
      doc_group: (row.doc_group as string) ?? null,
      sort_order: (row.sort_order as number) ?? 0,
    };
  }

  // ---------------------------------------------------------------------------
  // 이미지 구역 이동 (재분류)
  // ---------------------------------------------------------------------------
  async function moveImage(img: BoardImage) {
    const others = zones.filter((z) => z.id !== img.zone_id);
    if (others.length === 0) {
      alert("이동할 다른 구역이 없습니다. 먼저 존을 추가하세요.");
      return;
    }
    const menu = others.map((z, i) => `${i + 1}. ${z.title}`).join("\n");
    const pick = window.prompt(`어느 구역으로 옮길까요?\n${menu}\n\n번호 입력:`);
    if (!pick) return;
    const idx = parseInt(pick, 10) - 1;
    const target = others[idx];
    if (!target) {
      alert("잘못된 번호입니다.");
      return;
    }
    const maxSort = Math.max(0, ...images.filter((i) => i.zone_id === target.id).map((i) => i.sort_order));
    const prevZone = img.zone_id;
    patchImage(img.id, { zone_id: target.id, sort_order: maxSort + 1 });
    const { error } = await supabase
      .from("ref_images")
      .update({ zone_id: target.id, sort_order: maxSort + 1 })
      .eq("id", img.id);
    if (error) {
      patchImage(img.id, { zone_id: prevZone, sort_order: img.sort_order });
      alert("이동 실패: " + error.message);
    } else {
      logEvent("ref.image_moved", { image_id: img.id, from: prevZone, to: target.id });
    }
  }

  // ---------------------------------------------------------------------------
  // 파일 링크 (board_assets) CRUD
  // ---------------------------------------------------------------------------
  async function addAsset() {
    const name = window.prompt("링크 이름 (예: 드라이브, 피그마, 견적서)");
    if (!name?.trim()) return;
    const url = window.prompt("URL (비워두면 '미연결'로 추가)") ?? "";
    const value = /^https?:\/\//.test(url.trim()) ? url.trim() : null;
    const { data: inserted, error } = await supabase
      .from("board_assets")
      .insert({
        board_id: board.id,
        name: name.trim(),
        url: value,
        sort_order: Math.max(0, ...assets.map((a) => a.sort_order)) + 1,
      })
      .select()
      .single();
    if (error) {
      alert("링크 추가 실패: " + error.message);
      return;
    }
    setAssets((prev) => [...prev, inserted]);
    logEvent("asset.added", { asset_id: inserted.id, name: name.trim() });
  }

  async function editAssetUrl(assetId: string) {
    const a = assets.find((x) => x.id === assetId);
    if (!a) return;
    const url = window.prompt(`"${a.name}" URL`, a.url ?? "");
    if (url === null) return;
    const value = /^https?:\/\//.test(url.trim()) ? url.trim() : null;
    setAssets((prev) => prev.map((x) => (x.id === assetId ? { ...x, url: value } : x)));
    const { error } = await supabase.from("board_assets").update({ url: value }).eq("id", assetId);
    if (error) {
      setAssets((prev) => prev.map((x) => (x.id === assetId ? { ...x, url: a.url } : x)));
      alert("저장 실패: " + error.message);
    }
  }

  async function removeAsset(assetId: string) {
    const a = assets.find((x) => x.id === assetId);
    if (!a || !window.confirm(`"${a.name}" 링크를 삭제할까요?`)) return;
    setAssets((prev) => prev.filter((x) => x.id !== assetId));
    const { error } = await supabase.from("board_assets").delete().eq("id", assetId);
    if (error) {
      setAssets((prev) => [...prev, a]);
      alert("삭제 실패: " + error.message);
    } else {
      logEvent("asset.removed", { name: a.name });
    }
  }

  // ---------------------------------------------------------------------------
  // 개인 수집함 공개 토글 (소유자)
  // ---------------------------------------------------------------------------
  async function toggleShared() {
    const next = !isShared;
    setIsShared(next);
    const { error } = await supabase.from("boards").update({ shared: next }).eq("id", board.id);
    if (error) {
      setIsShared(!next);
      alert("변경 실패: " + error.message);
    } else {
      logEvent("board.shared_toggled", { shared: next });
    }
  }

  // ---------------------------------------------------------------------------
  // 접근 제한 (director — 인원별 자료 한정)
  // ---------------------------------------------------------------------------
  async function saveAccess(nextAccess: string, nextMembers: Set<string>) {
    const prev = { access, members: new Set(memberIds) };
    setAccess(nextAccess);
    setMemberIds(new Set(nextMembers));
    const { error } = await supabase.rpc("set_board_access", {
      p_board_id: board.id,
      p_access: nextAccess,
      p_member_ids: [...nextMembers],
    });
    if (error) {
      setAccess(prev.access);
      setMemberIds(prev.members);
      alert("접근 설정 저장 실패: " + error.message);
    }
  }

  // ---------------------------------------------------------------------------
  // 존 mutations
  // ---------------------------------------------------------------------------
  async function addZone() {
    const title = window.prompt("새 구역 이름");
    if (!title?.trim()) return;
    const { data: inserted, error } = await supabase
      .from("ref_zones")
      .insert({
        board_id: board.id,
        title: title.trim(),
        sort_order: Math.max(0, ...zones.map((z) => z.sort_order)) + 1,
      })
      .select()
      .single();
    if (error) {
      alert("구역 추가 실패: " + error.message);
      return;
    }
    setZones((prev) => [...prev, inserted]);
    logEvent("ref.zone_added", { zone_id: inserted.id, title: title.trim() });
  }

  async function renameZone(z: BoardZone) {
    const title = window.prompt("구역 이름", z.title);
    if (!title?.trim() || title === z.title) return;
    setZones((prev) => prev.map((x) => (x.id === z.id ? { ...x, title } : x)));
    await supabase.from("ref_zones").update({ title }).eq("id", z.id);
  }

  async function editBatch(z: BoardZone) {
    const batch = window.prompt("수령/수집 배지 (예: 26.07.06 · 시안 수령)", z.batch_label ?? "");
    if (batch === null) return;
    const value = batch.trim() === "" ? null : batch;
    setZones((prev) => prev.map((x) => (x.id === z.id ? { ...x, batch_label: value } : x)));
    await supabase.from("ref_zones").update({ batch_label: value }).eq("id", z.id);
  }

  async function removeZone(z: BoardZone) {
    const count = images.filter((i) => i.zone_id === z.id).length;
    if (!window.confirm(`"${z.title}" 구역과 이미지 ${count}장을 삭제할까요?`)) return;
    const { error } = await supabase.from("ref_zones").delete().eq("id", z.id);
    if (error) {
      alert("삭제 실패: " + error.message);
      return;
    }
    setZones((prev) => prev.filter((x) => x.id !== z.id));
    setImages((prev) => prev.filter((i) => i.zone_id !== z.id));
    logEvent("ref.zone_removed", { zone_id: z.id, title: z.title });
  }

  // ---------------------------------------------------------------------------
  // 표시 계산
  // ---------------------------------------------------------------------------
  const visible = useMemo(
    () =>
      images.filter((i) => {
        if (i.hidden && !(editing && showHidden)) return false;
        if (mode === "stars" && !i.starred) return false;
        return true;
      }),
    [images, mode, editing, showHidden],
  );
  const byZone = useMemo(() => {
    const m = new Map<string, BoardImage[]>();
    for (const i of visible) {
      const arr = m.get(i.zone_id) ?? [];
      arr.push(i);
      m.set(i.zone_id, arr);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.sort_order - b.sort_order);
    return m;
  }, [visible]);

  const openLightbox = useCallback(
    (img: BoardImage) => {
      const idx = visible.findIndex((v) => v.id === img.id);
      if (idx >= 0) setLightbox(idx);
    },
    [visible],
  );
  useEffect(() => {
    if (lightbox === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
      if (e.key === "ArrowLeft")
        setLightbox((i) => (i === null ? null : (i + visible.length - 1) % visible.length));
      if (e.key === "ArrowRight")
        setLightbox((i) => (i === null ? null : (i + 1) % visible.length));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox, visible.length]);

  const openCount = directionLogs.filter((l) => l.status === "open").length;
  const lb = lightbox !== null ? visible[lightbox] : null;
  const lbZone = lb ? zones.find((z) => z.id === lb.zone_id) : null;

  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-board-bg text-board-ink">
      <input type="file" ref={fileInput} accept="image/*" multiple hidden onChange={onFilesChosen} />

      {/* ===== 보드 상단 바 ===== */}
      <div className="sticky top-14 z-30 border-b border-board-line bg-board-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-5 pt-3">
          <h1 className="text-[17px] font-extrabold">
            {board.projectCode && (
              <em className="not-italic text-gold-bright">{board.projectCode} </em>
            )}
            {board.title}
          </h1>
          <span className="font-mono text-xs text-board-mut">
            {board.kind === "project" ? "프로젝트 보드" : board.kind === "shared" ? "공용 보드" : `개인 수집함${isShared ? " · 공개" : ""}`}
            {" · "}
            {visible.filter((v) => !v.hidden).length}장
            {busy === "upload" && <span className="ml-2 text-gold-bright">업로드 중...</span>}
          </span>
          <div className="ml-auto flex flex-wrap gap-2">
            {board.kind === "personal" && board.owner_id === meId && (
              <PillBtn on={isShared} onClick={toggleShared}>
                {isShared ? "전체 공개 중" : "비공개"}
              </PillBtn>
            )}
            <PillBtn on={mode === "stars"} onClick={() => setMode(mode === "stars" ? "all" : "stars")}>
              ★ 별표만
            </PillBtn>
            <PillBtn on={mode === "verdict"} onClick={() => setMode(mode === "verdict" ? "all" : "verdict")}>
              판정 모아보기
            </PillBtn>
            {editing && (
              <>
                <PillBtn on={showHidden} onClick={() => setShowHidden(!showHidden)}>
                  숨긴 항목
                </PillBtn>
                <PillBtn on={false} onClick={addZone}>
                  ＋ 존 추가
                </PillBtn>
              </>
            )}
            {isDirector && (
              <PillBtn on={accessOpen || access === "restricted"} onClick={() => setAccessOpen(!accessOpen)}>
                {access === "restricted" ? `🔒 지정 ${memberIds.size}명` : "접근 관리"}
              </PillBtn>
            )}
            {canEdit && (
              <PillBtn on={editing} onClick={() => { setEditing(!editing); if (editing) setShowHidden(false); }}>
                {editing ? "편집 완료" : "편집"}
              </PillBtn>
            )}
            <Link
              href="/boards"
              className="rounded-full border border-board-line bg-board-panel px-3.5 py-1.5 text-xs text-board-mut hover:text-board-ink"
            >
              보드 목록
            </Link>
          </div>
        </div>
        {/* 스케줄 연계 칩 (프로젝트 보드) */}
        {schedule && (
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-2 px-5 pt-2 text-[11.5px]">
            {schedule.nextMilestone && (
              <span className="flex items-center gap-1.5 rounded-full border border-gold-bright/40 px-2.5 py-1 text-gold-bright">
                <span className="inline-block h-1.5 w-1.5 rotate-45 bg-gold-bright" />
                {schedule.nextMilestone.label} · {schedule.nextMilestone.due}
              </span>
            )}
            {schedule.imminentCount > 0 && (
              <span className="rounded-full border border-verdict-bad/50 px-2.5 py-1 font-semibold text-verdict-bad">
                ⚠ 마감 임박 {schedule.imminentCount}
              </span>
            )}
            <span className="rounded-full border border-board-line px-2.5 py-1 text-board-mut">
              진행 중 태스크 {schedule.activeCount}
            </span>
            <Link href="/" className="text-board-mut underline-offset-2 hover:text-gold-bright hover:underline">
              타임라인에서 보기 →
            </Link>
          </div>
        )}
        {/* 접근 관리 패널 (director) */}
        {isDirector && accessOpen && (
          <div className="mx-auto max-w-[1600px] px-5 pb-1 pt-2.5">
            <div className="rounded-xl border border-gold-bright/30 bg-board-panel px-4 py-3.5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-[13px] font-bold">이 보드를 볼 수 있는 인원</span>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => saveAccess("default", memberIds)}
                    className={
                      "rounded-full border px-3 py-1 text-[11.5px] " +
                      (access === "default"
                        ? "border-gold-bright bg-gold-bright font-bold text-board-bg"
                        : "border-board-line text-board-mut hover:text-board-ink")
                    }
                  >
                    기본 규칙 (자동)
                  </button>
                  <button
                    onClick={() => saveAccess("restricted", memberIds)}
                    className={
                      "rounded-full border px-3 py-1 text-[11.5px] " +
                      (access === "restricted"
                        ? "border-gold-bright bg-gold-bright font-bold text-board-bg"
                        : "border-board-line text-board-mut hover:text-board-ink")
                    }
                  >
                    🔒 지정 인원만
                  </button>
                </div>
                <span className="text-[11px] text-board-mut">
                  {access === "default"
                    ? board.kind === "project"
                      ? "이 프로젝트에 태스크가 배정된 인원 전원"
                      : board.kind === "shared"
                        ? "전 인원"
                        : "소유자" + (board.shared ? " + 전 인원(공개)" : "만")
                    : "아래 체크된 인원만 열람·편집 (대표는 항상 접근)"}
                </span>
              </div>
              {access === "restricted" && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {team
                    .filter((t) => t.role !== "director")
                    .map((t) => {
                      const on = memberIds.has(t.id);
                      return (
                        <button
                          key={t.id}
                          onClick={() => {
                            const next = new Set(memberIds);
                            if (on) next.delete(t.id);
                            else next.add(t.id);
                            saveAccess("restricted", next);
                          }}
                          className={
                            "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors " +
                            (on
                              ? "border-gold-bright/60 bg-gold-bright/15 text-board-ink"
                              : "border-board-line text-board-mut hover:text-board-ink")
                          }
                        >
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: t.color }} />
                          {t.name}
                          {on && <span className="text-gold-bright">✓</span>}
                        </button>
                      );
                    })}
                </div>
              )}
            </div>
          </div>
        )}
        {mode !== "verdict" && (
          <nav className="mx-auto flex max-w-[1600px] gap-2 overflow-x-auto px-5 py-2.5 [scrollbar-width:none]">
            {zones.map((z, i) => (
              <a
                key={z.id}
                href={`#zone-${z.id}`}
                className="flex shrink-0 items-center gap-2 rounded-full border border-board-line bg-board-panel px-3 py-1.5 text-xs text-board-mut hover:text-board-ink"
              >
                <span className="font-mono text-[10px] text-gold-bright">
                  {String(i + 1).padStart(2, "0")}
                </span>
                {z.title}
                <span className="font-mono text-[10px] opacity-70">
                  {(byZone.get(z.id) ?? []).length}
                </span>
              </a>
            ))}
          </nav>
        )}
      </div>

      <main className="mx-auto max-w-[1600px] px-5 pb-24">
        {/* ===== LOG 패널 (7e에서 편집 추가) ===== */}
        <section className="mt-5 rounded-xl border border-board-line bg-board-panel px-5 pb-3 pt-4">
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="rounded border border-gold-bright/40 px-1.5 py-0.5 font-mono text-[11px] text-gold-bright">
              LOG
            </span>
            <h2 className="text-[15px] font-extrabold">디렉션 로그 · 파일</h2>
            <span className="ml-auto text-[11px] text-board-mut">
              프로젝트 방향과 참고 파일을 여기에 정리합니다
            </span>
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {/* DEFERRED: BRIEF Phase 1 — 회의록 탭 숨김 (기능·데이터 유지)
            <ITab on={infoOpen && infoTab === "meetings"} onClick={() => { setInfoTab("meetings"); setInfoOpen(true); }}>
              회의록 <span className="font-mono text-[10px] opacity-75">{meetings.length}</span>
            </ITab>
            */}
            {board.kind === "project" && (
              <ITab on={infoOpen && infoTab === "logs"} onClick={() => { setInfoTab("logs"); setInfoOpen(true); }}>
                방향 로그 <span className="font-mono text-[10px] opacity-75">{directionLogs.length}</span>
              </ITab>
            )}
            <ITab on={infoOpen && infoTab === "assets"} onClick={() => { setInfoTab("assets"); setInfoOpen(true); }}>
              파일 링크 <span className="font-mono text-[10px] opacity-75">{assets.length}</span>
            </ITab>
            <button
              onClick={() => setInfoOpen(!infoOpen)}
              className="ml-auto rounded-full border border-board-line px-3 py-1 text-[11px] text-board-mut hover:text-gold-bright"
            >
              {infoOpen ? "접기 ▴" : "펼치기 ▾"}
            </button>
          </div>

          {!infoOpen && (
            <p className="py-2.5 text-[12.5px] leading-relaxed text-board-mut">
              {board.kind === "project" ? (
                directionLogs.length > 0 ? (
                  <>
                    방향 <b className="text-board-ink">{directionLogs.length}건</b>
                    {" · "}파일 링크 {assets.length}개
                  </>
                ) : (
                  "기록된 방향이 없습니다."
                )
              ) : (
                <>파일 링크 {assets.length}개</>
              )}
              {board.kind === "project" && openCount > 0 && (
                <span className="ml-2 rounded-full border border-gold-bright/50 px-2 py-0.5 text-[10.5px] text-gold-bright">
                  미확정 방향 {openCount}건
                </span>
              )}
            </p>
          )}

          {/* DEFERRED: BRIEF Phase 1 — 회의록 패널 숨김 (MeetingsPanel 유지)
          {infoOpen && infoTab === "meetings" && (
            <MeetingsPanel
              boardId={board.id}
              projectId={board.project_id}
              initial={meetings}
              meId={meId}
              isDirector={isDirector}
              canEdit={canEdit}
              team={team}
            />
          )} */}

          {infoOpen && infoTab === "logs" && board.kind === "project" && board.project_id && (
            <DirectionPanel
              projectId={board.project_id}
              boardId={board.id}
              initial={directionLogs}
              meId={meId}
              isDirector={isDirector}
              canEdit={canEdit}
              team={team}
            />
          )}

          {infoOpen && infoTab === "assets" && (
            <div className="py-2">
              {assets.map((a) => (
                <div key={a.id} className="flex items-center gap-2.5 border-t border-board-line py-2 text-[12.5px]">
                  <span className="font-mono text-[11.5px] text-[#cfccc4]">{a.name}</span>
                  {a.url ? (
                    <a href={a.url} target="_blank" rel="noreferrer" className="border-b border-dotted border-gold-bright/40 text-[11.5px] text-gold-bright">
                      열기 ↗
                    </a>
                  ) : (
                    <span className="text-[11px] text-board-mut/40">링크 미연결</span>
                  )}
                  {canEdit && (
                    <span className="ml-auto flex gap-1.5">
                      <ZoneTool onClick={() => editAssetUrl(a.id)} title="URL 연결/수정">
                        {a.url ? "수정" : "연결"}
                      </ZoneTool>
                      <ZoneTool onClick={() => removeAsset(a.id)} title="삭제">✕</ZoneTool>
                    </span>
                  )}
                </div>
              ))}
              {assets.length === 0 && (
                <p className="border-t border-board-line py-3 text-sm text-board-mut">등록된 링크가 없습니다.</p>
              )}
              {canEdit && (
                <button
                  onClick={addAsset}
                  className="mt-2 rounded-full border border-board-line px-3 py-1 text-[11.5px] text-board-mut hover:border-gold-bright hover:text-gold-bright"
                >
                  ＋ 링크 추가
                </button>
              )}
            </div>
          )}
        </section>

        {/* ===== 본문 ===== */}
        {mode === "verdict" ? (
          <VerdictView images={images} zones={zones} nameOf={nameOf} onOpen={openLightbox} />
        ) : (
          zones.map((z, zi) => {
            const zoneImages = byZone.get(z.id) ?? [];
            const groups = new Map<string, BoardImage[]>();
            const singles: BoardImage[] = [];
            for (const img of zoneImages) {
              if (img.doc_group) {
                const arr = groups.get(img.doc_group) ?? [];
                arr.push(img);
                groups.set(img.doc_group, arr);
              } else singles.push(img);
            }
            return (
              <section
                key={z.id}
                id={`zone-${z.id}`}
                className="pt-9 [content-visibility:auto] [contain-intrinsic-size:auto_800px]"
              >
                <header className="mb-4 flex flex-wrap items-baseline gap-3 border-b border-board-line pb-3">
                  <span className="rounded border border-gold-bright/40 px-1.5 py-0.5 font-mono text-[12px] text-gold-bright">
                    {String(zi + 1).padStart(2, "0")}
                  </span>
                  <h2 className="text-lg font-extrabold">{z.title}</h2>
                  {z.batch_label && (
                    <span className="rounded-full border border-board-line px-2 py-0.5 font-mono text-[10.5px] text-board-mut opacity-70">
                      {z.batch_label}
                    </span>
                  )}
                  {editing && (
                    <span className="flex gap-1.5">
                      <ZoneTool onClick={() => renameZone(z)} title="이름 변경">✎</ZoneTool>
                      <ZoneTool onClick={() => editBatch(z)} title="수령일 배지">📅</ZoneTool>
                      {canDelete && (
                        <ZoneTool onClick={() => removeZone(z)} title="구역 삭제">✕</ZoneTool>
                      )}
                    </span>
                  )}
                  <span className="ml-auto font-mono text-xs text-board-mut">{zoneImages.length}장</span>
                </header>

                {[...groups.entries()].map(([g, imgs]) => (
                  <div key={g} className="mb-4 rounded-xl border border-board-line bg-[#1f1f24] px-3.5 pb-2 pt-3 [column-span:all]">
                    <div className="mb-2.5 flex flex-wrap items-baseline gap-2.5 text-[13px]">
                      <span>📄</span>
                      <b>{g}</b>
                      <span className="font-mono text-[11px] text-board-mut">{imgs.length}p · 한 문서에서 추출</span>
                      <span className="ml-auto text-[10.5px] text-board-mut opacity-70">← 좌우 스크롤 →</span>
                    </div>
                    <div className="flex gap-0.5 overflow-x-auto pb-1.5 [scrollbar-width:thin]">
                      {imgs.map((img, pi) => (
                        <div key={img.id} className="relative w-[158px] shrink-0 cursor-zoom-in first:rounded-l-lg last:rounded-r-lg" onClick={() => openLightbox(img)}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img.src} alt="" loading="lazy" className="block h-auto w-full" />
                          <span className="pointer-events-none absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 font-mono text-[10px] text-white">
                            {pi + 1}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}

                <div className="[column-gap:10px] [columns:5_260px]">
                  {singles.map((img) => (
                    <Card
                      key={img.id}
                      img={img}
                      editing={editing}
                      isDirector={isDirector}
                      canRemove={canDelete || img.uploader_id === meId}
                      busy={busy === img.id}
                      onOpen={openLightbox}
                      onStar={() => toggleStar(img)}
                      onHide={() => toggleHidden(img)}
                      onMemo={() => editMemo(img)}
                      onMove={() => moveImage(img)}
                      onRemove={() => removeImage(img)}
                      onVerdict={(v) => setVerdict(img, v)}
                    />
                  ))}
                  {editing && (
                    <div className="mb-2.5 flex flex-col gap-1.5 [break-inside:avoid]">
                      <button
                        onClick={() => pickFiles(z.id)}
                        className="w-full rounded-lg border-[1.5px] border-dashed border-[#3d3d46] px-2.5 py-6 text-[13px] text-board-mut hover:border-gold-bright hover:text-gold-bright"
                      >
                        ＋ 파일 업로드
                      </button>
                      <button
                        onClick={() => addByUrl(z.id)}
                        className="w-full rounded-lg border-[1.5px] border-dashed border-[#3d3d46] px-2.5 py-2.5 text-[12px] text-board-mut hover:border-gold-bright hover:text-gold-bright"
                      >
                        URL 붙여넣기
                      </button>
                    </div>
                  )}
                  {singles.length === 0 && groups.size === 0 && !editing && (
                    <p className="py-6 text-sm text-board-mut">이 구역에 이미지가 없습니다.</p>
                  )}
                </div>
              </section>
            );
          })
        )}
      </main>

      {/* ===== 라이트박스 ===== */}
      {lb && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0a0a0c]/95 p-6"
          role="dialog"
          aria-modal
          onClick={() => setLightbox(null)}
        >
          <button className="fixed right-5 top-5 h-11 w-11 rounded-full border border-board-line text-lg text-board-ink hover:border-gold-bright hover:text-gold-bright" aria-label="닫기">
            ✕
          </button>
          <button
            className="fixed left-5 top-1/2 h-11 w-11 rounded-full border border-board-line text-lg text-board-ink hover:border-gold-bright hover:text-gold-bright"
            aria-label="이전"
            onClick={(e) => { e.stopPropagation(); setLightbox((i) => (i === null ? null : (i + visible.length - 1) % visible.length)); }}
          >
            ←
          </button>
          <button
            className="fixed right-5 top-1/2 h-11 w-11 rounded-full border border-board-line text-lg text-board-ink hover:border-gold-bright hover:text-gold-bright"
            aria-label="다음"
            onClick={(e) => { e.stopPropagation(); setLightbox((i) => (i === null ? null : (i + 1) % visible.length)); }}
          >
            →
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lb.src} alt="" className="max-h-[74vh] max-w-[92vw] rounded-md" onClick={(e) => e.stopPropagation()} />
          <div className="mt-3.5 flex flex-wrap items-center justify-center gap-3.5 text-[13px] text-board-mut" onClick={(e) => e.stopPropagation()}>
            <b className="text-board-ink">{lbZone?.title}</b>
            {lb.filename && <span className="font-mono text-[11.5px]">{lb.filename}</span>}
            {lb.starred && <span className="text-gold-bright">★ 채택 후보</span>}
            {lb.verdict && (
              <span className={lb.verdict === "good" ? "text-verdict-good" : "text-verdict-bad"}>
                {lb.verdict === "good" ? "● 좋음" : "● 나쁨"} — {nameOf(lb.verdict_by)}
              </span>
            )}
            <span className="font-mono text-[11px]">{(lightbox ?? 0) + 1} / {visible.length}</span>
            {isDirector && (
              <span className="flex gap-1.5">
                <button
                  onClick={() => setVerdict(lb, "good")}
                  className="rounded-full border border-verdict-good/50 px-2.5 py-0.5 text-[11px] text-verdict-good hover:bg-verdict-good hover:text-white"
                >
                  좋음
                </button>
                <button
                  onClick={() => setVerdict(lb, "bad")}
                  className="rounded-full border border-verdict-bad/50 px-2.5 py-0.5 text-[11px] text-verdict-bad hover:bg-verdict-bad hover:text-white"
                >
                  나쁨
                </button>
                {lb.verdict && (
                  <button
                    onClick={() => setVerdict(lb, null)}
                    className="rounded-full border border-board-line px-2.5 py-0.5 text-[11px] text-board-mut hover:text-board-ink"
                  >
                    해제
                  </button>
                )}
              </span>
            )}
          </div>
          {(lb.memo || lb.verdict_memo) && (
            <div className="mt-2 max-w-[70ch] text-center text-[13px] text-[#e8e2d2]" onClick={(e) => e.stopPropagation()}>
              {lb.memo && <p>{lb.memo}</p>}
              {lb.verdict_memo && (
                <p className={lb.verdict === "good" ? "mt-1 text-verdict-good" : "mt-1 text-verdict-bad"}>
                  판정: {lb.verdict_memo}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
function PillBtn({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={
        "rounded-full border px-3.5 py-1.5 text-xs transition-colors " +
        (on
          ? "border-gold-bright bg-gold-bright font-bold text-board-bg"
          : "border-board-line bg-board-panel text-board-ink hover:border-[#4a4a55]")
      }
    >
      {children}
    </button>
  );
}

function ITab({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={
        "rounded-full border px-3 py-1 text-xs transition-colors " +
        (on
          ? "border-gold-bright bg-gold-bright font-bold text-board-bg"
          : "border-board-line text-board-mut hover:text-board-ink")
      }
    >
      {children}
    </button>
  );
}

function ZoneTool({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="rounded-full border border-board-line px-2 py-0.5 text-[10.5px] text-board-mut hover:border-gold-bright hover:text-gold-bright"
    >
      {children}
    </button>
  );
}

function Card({
  img,
  editing,
  isDirector,
  canRemove,
  busy,
  onOpen,
  onStar,
  onHide,
  onMemo,
  onMove,
  onRemove,
  onVerdict,
}: {
  img: BoardImage;
  editing: boolean;
  isDirector: boolean;
  canRemove: boolean;
  busy: boolean;
  onOpen: (i: BoardImage) => void;
  onStar: () => void;
  onHide: () => void;
  onMemo: () => void;
  onMove: () => void;
  onRemove: () => void;
  onVerdict: (v: "good" | "bad" | null) => void;
}) {
  return (
    <figure
      className={
        "relative mb-2.5 cursor-zoom-in overflow-hidden rounded-lg bg-board-panel [break-inside:avoid] [content-visibility:auto]" +
        (img.hidden ? " opacity-40 outline-dashed outline-1 outline-[#666]" : "") +
        (busy ? " animate-pulse" : "")
      }
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={img.src} alt="" loading="lazy" className="block h-auto w-full hover:opacity-85" onClick={() => onOpen(img)} />
      {img.starred && (
        <span className="pointer-events-none absolute left-2 top-2 text-[15px] text-gold-bright [text-shadow:0_1px_4px_#000]">★</span>
      )}
      {img.verdict && (
        <span
          className={
            "pointer-events-none absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-bold text-white " +
            (img.verdict === "good" ? "bg-verdict-good" : "bg-verdict-bad")
          }
        >
          {img.verdict === "good" ? "좋음" : "나쁨"}
        </span>
      )}
      {editing && (
        <span className="absolute right-1.5 top-1.5 flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Tb on={img.starred} onClick={onStar} title="채택 후보 ★">★</Tb>
          <Tb on={img.hidden} onClick={onHide} title={img.hidden ? "숨김 해제" : "숨김"}>
            {img.hidden ? "👁" : "🙈"}
          </Tb>
          <Tb on={!!img.memo} onClick={onMemo} title="메모">✎</Tb>
          <Tb on={false} onClick={onMove} title="구역 이동">⇄</Tb>
          {isDirector && (
            <>
              <Tb on={img.verdict === "good"} onClick={() => onVerdict("good")} title="좋음 판정" tone="good">✓</Tb>
              <Tb on={img.verdict === "bad"} onClick={() => onVerdict("bad")} title="나쁨 판정" tone="bad">✗</Tb>
            </>
          )}
          {canRemove && <Tb on={false} onClick={onRemove} title="삭제">🗑</Tb>}
        </span>
      )}
      {img.memo && (
        <figcaption className="whitespace-pre-wrap border-t border-board-line bg-[#232327] px-2.5 py-2 text-xs text-[#d8d4ca]">
          {img.memo}
        </figcaption>
      )}
    </figure>
  );
}

function Tb({
  on,
  onClick,
  title,
  tone,
  children,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  tone?: "good" | "bad";
  children: React.ReactNode;
}) {
  const onCls =
    tone === "good"
      ? "bg-verdict-good text-white"
      : tone === "bad"
        ? "bg-verdict-bad text-white"
        : "bg-gold-bright text-board-bg";
  return (
    <button
      onClick={onClick}
      title={title}
      className={
        "h-[26px] w-[26px] rounded-md text-[12px] leading-none transition-colors " +
        (on ? onCls : "bg-[#141416]/85 text-board-ink hover:bg-gold-bright hover:text-board-bg")
      }
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
function VerdictView({
  images,
  zones,
  nameOf,
  onOpen,
}: {
  images: BoardImage[];
  zones: BoardZone[];
  nameOf: (id: string | null) => string;
  onOpen: (i: BoardImage) => void;
}) {
  const zoneTitle = (id: string) => zones.find((z) => z.id === id)?.title ?? "";
  const good = images.filter((i) => !i.hidden && i.verdict === "good");
  const bad = images.filter((i) => !i.hidden && i.verdict === "bad");
  const none = images.filter((i) => !i.hidden && !i.verdict);

  return (
    <>
      <VerdictGroup title="● 좋음 — 이 프로젝트에서 통하는 것" tone="var(--color-verdict-good)" list={good} withMemo zoneTitle={zoneTitle} nameOf={nameOf} onOpen={onOpen} />
      <VerdictGroup title="● 나쁨 — 피할 것" tone="var(--color-verdict-bad)" list={bad} withMemo zoneTitle={zoneTitle} nameOf={nameOf} onOpen={onOpen} />
      <VerdictGroup title="미판정" tone="var(--color-board-mut)" list={none} withMemo={false} zoneTitle={zoneTitle} nameOf={nameOf} onOpen={onOpen} />
    </>
  );
}

function VerdictGroup({
  title,
  tone,
  list,
  withMemo,
  zoneTitle,
  nameOf,
  onOpen,
}: {
  title: string;
  tone: string;
  list: BoardImage[];
  withMemo: boolean;
  zoneTitle: (id: string) => string;
  nameOf: (id: string | null) => string;
  onOpen: (i: BoardImage) => void;
}) {
  return (
    <section className="pt-9">
      <header className="mb-4 flex items-baseline gap-3 border-b border-board-line pb-3">
        <h2 className="text-lg font-extrabold" style={{ color: tone }}>
          {title}
        </h2>
        <span className="font-mono text-xs text-board-mut">{list.length}장</span>
        {withMemo && (
          <span className="ml-auto text-[11px] text-board-mut">
            &quot;왜&quot;가 핵심 전달물 — 이유를 함께 읽으세요
          </span>
        )}
      </header>
      {withMemo ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((img) => (
            <div key={img.id} className="flex gap-3 rounded-xl border border-board-line bg-board-panel p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.src}
                alt=""
                loading="lazy"
                className="h-28 w-24 shrink-0 cursor-zoom-in rounded-md object-cover"
                onClick={() => onOpen(img)}
              />
              <div className="min-w-0 text-[12px] leading-relaxed">
                <div className="mb-1 font-mono text-[10px] text-board-mut">
                  {zoneTitle(img.zone_id)} · {nameOf(img.verdict_by)}
                </div>
                <p className="text-[#e8e2d2]">{img.verdict_memo}</p>
              </div>
            </div>
          ))}
          {list.length === 0 && <p className="text-sm text-board-mut">없음</p>}
        </div>
      ) : (
        <div className="[column-gap:10px] [columns:6_200px]">
          {list.map((img) => (
            <figure key={img.id} className="relative mb-2.5 cursor-zoom-in overflow-hidden rounded-lg bg-board-panel [break-inside:avoid]" onClick={() => onOpen(img)}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.src} alt="" loading="lazy" className="block h-auto w-full hover:opacity-85" />
              {img.starred && (
                <span className="absolute left-2 top-2 text-[15px] text-gold-bright [text-shadow:0_1px_4px_#000]">★</span>
              )}
            </figure>
          ))}
        </div>
      )}
    </section>
  );
}
