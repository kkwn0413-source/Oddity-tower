"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** 본인 비밀번호 변경 — supabase.auth.updateUser (본인 세션으로만 동작). */
export function AccountForm({ name }: { name: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    setDone(false);
    if (pw.length < 8) return setError("비밀번호는 8자 이상이어야 합니다.");
    if (pw !== pw2) return setError("비밀번호가 서로 다릅니다.");
    setBusy(true);
    const { error: e } = await supabase.auth.updateUser({ password: pw });
    setBusy(false);
    if (e) return setError("변경 실패: " + e.message);
    setPw("");
    setPw2("");
    setDone(true);
  }

  const input =
    "w-full rounded-md border border-navy/15 bg-white px-2.5 py-1.5 text-sm text-navy outline-none focus:border-gold focus:ring-1 focus:ring-gold/25";

  return (
    <div className="rounded-xl bg-card p-5 shadow-sm">
      <h1 className="text-lg font-bold text-navy">내 계정</h1>
      <p className="mt-0.5 text-xs text-navy/45">{name} 님의 비밀번호를 변경합니다.</p>
      <div className="mt-4 flex flex-col gap-2.5">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-navy/40">새 비밀번호</div>
          <input type="password" className={input + " mt-1"} value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-navy/40">새 비밀번호 확인</div>
          <input
            type="password"
            className={input + " mt-1"}
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            autoComplete="new-password"
          />
        </div>
        <div className="mt-1 flex items-center gap-2">
          <button
            onClick={submit}
            disabled={busy}
            className="rounded-md bg-navy px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "변경 중..." : "비밀번호 변경"}
          </button>
          {done && <span className="text-xs font-medium text-[#1D9E75]">변경되었습니다 ✓</span>}
          {error && <span className="text-xs text-danger">{error}</span>}
        </div>
      </div>
    </div>
  );
}
