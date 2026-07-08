"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "타임라인", directorOnly: false },
  { href: "/boards", label: "보드", directorOnly: false },
  { href: "/me", label: "내 작업", directorOnly: false },
  { href: "/worklog", label: "업무일지", directorOnly: false },
  { href: "/admin/share", label: "공유 링크", directorOnly: true },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function MainNav({ role }: { role: "director" | "freelancer" | string }) {
  const pathname = usePathname();
  const items = NAV_ITEMS.filter(
    (i) => !i.directorOnly || role === "director",
  );
  return (
    <nav className="hidden items-center gap-1 sm:flex">
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={
              "rounded-md px-3 py-1.5 text-sm transition-colors " +
              (active
                ? "bg-white/10 text-white"
                : "text-white/60 hover:bg-white/5 hover:text-white")
            }
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
