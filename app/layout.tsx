import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { getProfile } from "@/lib/auth";

export const metadata: Metadata = {
  title: "오디티하우스 컨트롤타워",
  description: "디자인 프리랜서 컨트롤타워 — 프로젝트·일정·파일 관리",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const profile = await getProfile();
  return (
    <html lang="ko" className="h-full">
      <head>
        {/* Pretendard (하우스 폰트) — CDN, dynamic subset */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body className="min-h-full">
        <AppShell profile={profile}>{children}</AppShell>
      </body>
    </html>
  );
}
