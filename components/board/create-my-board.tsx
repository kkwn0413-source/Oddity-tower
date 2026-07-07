"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** 개인 수집함이 없는 사용자용 생성 버튼 (인당 1개 — DB unique 강제) */
export function CreateMyBoard({ meId, meName }: { meId: string; meName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("boards")
      .insert({ kind: "personal", owner_id: meId, title: `${meName} 수집함` })
      .select()
      .single();
    setBusy(false);
    if (error) {
      alert("생성 실패: " + error.message);
      return;
    }
    router.push(`/boards/${data.id}`);
  }

  return (
    <button
      onClick={create}
      disabled={busy}
      className="rounded-xl border-2 border-dashed border-navy/15 bg-transparent p-5 text-left text-sm text-navy/50 transition-colors hover:border-gold hover:text-gold disabled:opacity-50"
    >
      ＋ 내 수집함 만들기
      <span className="mt-1 block text-xs text-navy/35">
        개인 레퍼런스 공간 — 원하면 전체 공개로 전환 가능
      </span>
    </button>
  );
}
