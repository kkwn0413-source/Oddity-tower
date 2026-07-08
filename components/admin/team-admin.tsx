"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * 팀 관리 화면 (director 전용).
 * 계정 발급 시 초기 비밀번호는 이 화면에 1회만 표시된다 — 복사해서 당사자에게 전달.
 */

type Member = {
  id: string;
  name: string;
  role: "director" | "freelancer";
  color: string;
  email: string;
  active: boolean;
  is_me: boolean;
  created_at: string;
};

const PALETTE = ["#1D9E75", "#7F77DD", "#D8643A", "#2E7FB8", "#B8965A"];

export function TeamAdmin() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 발급/재발급된 비밀번호 — {memberId: password} 1회 표시용
  const [issued, setIssued] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState<string | null>(null);

  // 생성 폼
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [color, setColor] = useState(PALETTE[0]);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/team");
    const data = await res.json();
    if (res.ok) setMembers(data.members);
    else setError(data.error);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function call(body: Record<string, unknown>): Promise<Record<string, string> | null> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/team", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "요청 실패");
      await load();
      return data;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function createMember() {
    if (!name.trim() || !email.trim()) return setError("이름과 이메일을 입력해주세요.");
    const data = await call({ action: "create", name, email, color });
    if (data?.password && data.id) {
      setIssued((prev) => ({ ...prev, [data.id]: data.password }));
      setName("");
      setEmail("");
    }
  }

  async function resetPassword(m: Member) {
    if (!window.confirm(`${m.name} 님의 비밀번호를 재발급할까요? (기존 비밀번호는 즉시 무효)`)) return;
    const data = await call({ action: "reset_password", id: m.id });
    if (data?.password) setIssued((prev) => ({ ...prev, [m.id]: data.password }));
  }

  async function rename(m: Member) {
    const next = window.prompt("새 이름", m.name);
    if (!next?.trim() || next.trim() === m.name) return;
    await call({ action: "update", id: m.id, name: next.trim() });
  }

  async function changeColor(m: Member, c: string) {
    await call({ action: "update", id: m.id, color: c });
  }

  async function toggleActive(m: Member) {
    const msg = m.active
      ? `${m.name} 님을 비활성화할까요? 로그인이 차단됩니다. (기록·배정은 유지)`
      : `${m.name} 님을 다시 활성화할까요?`;
    if (!window.confirm(msg)) return;
    await call({ action: "set_active", id: m.id, active: !m.active });
  }

  function copy(id: string, pw: string) {
    void navigator.clipboard.writeText(pw).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  const input =
    "rounded-md border border-navy/15 bg-white px-2.5 py-1.5 text-sm text-navy outline-none focus:border-gold focus:ring-1 focus:ring-gold/25";

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-xl font-bold text-navy">팀 관리</h1>
        <p className="mt-0.5 text-xs text-navy/45">
          계정을 발급하면 초기 비밀번호가 아래에 한 번만 표시됩니다 — 복사해서 당사자에게 전달하세요.
          각자 로그인 후 우측 상단 이름 → 비밀번호 변경이 가능합니다.
        </p>
      </div>

      {/* 계정 발급 */}
      <div className="rounded-xl bg-card p-4 shadow-sm">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-navy/40">새 멤버 계정 발급</div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input className={input + " w-32"} placeholder="이름" value={name} onChange={(e) => setName(e.target.value)} />
          <input className={input + " w-56"} placeholder="이메일" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <div className="flex items-center gap-1">
            {PALETTE.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={"h-6 w-6 rounded-full border-2 " + (color === c ? "border-navy" : "border-transparent")}
                style={{ backgroundColor: c }}
                aria-label={c}
              />
            ))}
          </div>
          <button
            onClick={createMember}
            disabled={busy}
            className="rounded-md bg-navy px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            발급
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-danger">{error}</p>}
      </div>

      {/* 멤버 목록 */}
      <div className="flex flex-col gap-2">
        {loading && <p className="text-sm text-navy/40">불러오는 중...</p>}
        {members.map((m) => (
          <div key={m.id} className={"rounded-xl bg-card px-4 py-3 shadow-sm " + (m.active ? "" : "opacity-60")}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: m.color }} />
              <span className="text-[14px] font-semibold text-navy">{m.name}</span>
              {m.role === "director" && (
                <span className="rounded bg-gold/15 px-1.5 py-0.5 text-[10px] font-bold text-gold">대표</span>
              )}
              {m.is_me && <span className="text-[10px] text-navy/35">(나)</span>}
              {!m.active && (
                <span className="rounded bg-danger/10 px-1.5 py-0.5 text-[10px] font-bold text-danger">비활성화됨</span>
              )}
              <span className="text-xs text-navy/45">{m.email}</span>

              <span className="ml-auto flex items-center gap-1">
                <button onClick={() => rename(m)} className="rounded px-2 py-1 text-[11px] text-navy/45 hover:bg-navy/5 hover:text-navy">
                  이름
                </button>
                <span className="flex items-center gap-0.5 rounded px-1 py-1">
                  {PALETTE.map((c) => (
                    <button
                      key={c}
                      onClick={() => changeColor(m, c)}
                      className={"h-3.5 w-3.5 rounded-full border " + (m.color === c ? "border-navy" : "border-black/10")}
                      style={{ backgroundColor: c }}
                      aria-label={"색상 " + c}
                    />
                  ))}
                </span>
                <button onClick={() => resetPassword(m)} className="rounded px-2 py-1 text-[11px] text-navy/45 hover:bg-navy/5 hover:text-navy">
                  비번 재발급
                </button>
                {!m.is_me && (
                  <button
                    onClick={() => toggleActive(m)}
                    className={
                      "rounded px-2 py-1 text-[11px] " +
                      (m.active ? "text-danger/70 hover:bg-danger/5 hover:text-danger" : "text-navy/45 hover:bg-navy/5 hover:text-navy")
                    }
                  >
                    {m.active ? "비활성화" : "활성화"}
                  </button>
                )}
              </span>
            </div>

            {issued[m.id] && (
              <div className="mt-2 flex items-center gap-2 rounded-lg bg-gold/8 px-3 py-2">
                <span className="text-[11px] font-semibold text-gold">초기 비밀번호</span>
                <code className="text-[13px] font-bold tracking-wide text-navy">{issued[m.id]}</code>
                <button
                  onClick={() => copy(m.id, issued[m.id])}
                  className="rounded border border-navy/15 px-2 py-0.5 text-[11px] text-navy/60 hover:text-navy"
                >
                  {copied === m.id ? "복사됨 ✓" : "복사"}
                </button>
                <span className="text-[10px] text-navy/40">지금만 표시됩니다 — 당사자에게 전달하세요</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
