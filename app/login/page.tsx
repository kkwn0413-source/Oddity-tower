"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next") ?? "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setState("submitting");
    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      setErrorMsg(
        /invalid login credentials/i.test(error.message)
          ? "이메일 또는 비밀번호가 올바르지 않습니다."
          : "로그인에 실패했습니다. 잠시 후 다시 시도해주세요.",
      );
      setState("error");
      return;
    }
    // freelancer의 기본 진입점은 /me (스펙 6.1)
    let dest = next.startsWith("/") ? next : "/";
    if (dest === "/") {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", data.user.id)
        .single();
      if (profile?.role === "freelancer") dest = "/me";
    }
    router.push(dest);
    router.refresh();
  }

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-xl border border-black/5 bg-card p-8 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 rotate-45 bg-gold" aria-hidden />
          <h1 className="text-lg font-semibold text-navy">로그인</h1>
        </div>
        <p className="mt-2 text-sm text-navy/50">
          계정은 대표가 발급합니다. 비밀번호를 잊었다면 대표에게 문의하세요.
        </p>

        <form onSubmit={signIn} className="mt-6 space-y-3">
          <input
            type="email"
            required
            autoFocus
            autoComplete="username"
            placeholder="이메일"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-navy/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold focus:ring-2 focus:ring-gold/25"
          />
          <input
            type="password"
            required
            autoComplete="current-password"
            placeholder="비밀번호"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-md border border-navy/15 bg-white px-3 py-2 text-sm text-navy outline-none focus:border-gold focus:ring-2 focus:ring-gold/25"
          />
          {state === "error" && (
            <p className="text-sm text-danger">{errorMsg}</p>
          )}
          <button
            type="submit"
            disabled={state === "submitting"}
            className="w-full rounded-md bg-navy px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {state === "submitting" ? "로그인 중..." : "로그인"}
          </button>
        </form>
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
