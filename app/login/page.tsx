"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";
  const linkError = searchParams.get("error") === "link";

  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const [errorMsg, setErrorMsg] = useState("");

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        // 가입은 director 초대(프로필 사전 생성)로만 — 공개 가입 없음
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      setErrorMsg(
        /not (allowed|found)|signups/i.test(error.message)
          ? "등록되지 않은 이메일입니다. 대표에게 초대를 요청하세요."
          : "전송에 실패했습니다. 잠시 후 다시 시도해주세요.",
      );
      setState("error");
    } else {
      setState("sent");
    }
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-black/5 bg-card p-8 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rotate-45 bg-gold" aria-hidden />
          <h1 className="text-lg font-semibold text-navy">로그인</h1>
        </div>
        <p className="mt-2 text-sm text-navy/50">
          등록된 이메일로 로그인 링크를 보내드립니다.
        </p>

        {linkError && state === "idle" && (
          <p className="mt-4 rounded-md bg-danger/10 px-3 py-2 text-sm text-danger">
            링크가 만료됐거나 잘못됐습니다. 다시 요청해주세요.
          </p>
        )}

        {state === "sent" ? (
          <div className="mt-6 rounded-md bg-gold/10 px-4 py-4 text-sm text-navy">
            <strong className="font-semibold">{email}</strong> 으로 로그인
            링크를 보냈습니다. 메일함을 확인해주세요.
          </div>
        ) : (
          <form onSubmit={sendMagicLink} className="mt-6 space-y-3">
            <input
              type="email"
              required
              autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-md border border-navy/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold focus:ring-2 focus:ring-gold/25"
            />
            {state === "error" && (
              <p className="text-sm text-danger">{errorMsg}</p>
            )}
            <button
              type="submit"
              disabled={state === "sending"}
              className="w-full rounded-md bg-navy px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {state === "sending" ? "전송 중..." : "매직링크 보내기"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
