"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { href: "/", label: "타임라인" },
  { href: "/me", label: "내 작업" },
  { href: "/admin/share", label: "공유 링크" },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}

export function MainNav() {
  const pathname = usePathname();
  return (
    <nav className="hidden items-center gap-1 sm:flex">
      {NAV_ITEMS.map((item) => {
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
                : "text-white/60 hover:text-white hover:bg-white/5")
            }
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
