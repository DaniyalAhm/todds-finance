"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";

type User = {
  username: string;
};

const navItems = [
  {
    label: "Home",
    href: "/",
  },
  {
    label: "Auto-Categorize",
    href: "/auto-categorize",
  },

  {
    label: "Merge-payees",
    href: "/merge-payees",
  },

  {
    label: "Configuration",
    href: "/configuration",
  },
];

export default function Header() {
  const pathname = usePathname();

  const [user, setUser] = useState<User | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    async function checkSession() {
      try {
        const res = await fetch("/api/auth/me", {
          method: "GET",
          credentials: "include",
        });

        if (!res.ok) {
          setUser(null);
          return;
        }

        const data = await res.json();
        setUser(data.user);
      } catch {
        setUser(null);
      }
    }

    checkSession();
  }, []);

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b border-zinc-800 bg-zinc-950/95 text-zinc-100 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
        <div className="flex flex-col gap-1">
          <Link
            href="/"
            className="text-2xl font-bold uppercase tracking-[0.50em] text-violet-300"
          >
            Todd&apos;s Finance
          </Link>

          {user && (
            <p className="hidden text-xs text-zinc-500 sm:block">
              Signed in as {user.username}
            </p>
          )}
        </div>

        <nav className="hidden gap-1 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-1 md:flex">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-xl px-4 py-2 text-sm font-medium transition ${
                isActive(item.href)
                  ? "bg-violet-500/20 text-violet-200"
                  : "text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <button
          onClick={() => setIsOpen((open) => !open)}
          className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-2 text-zinc-300 hover:text-zinc-100 md:hidden"
          aria-label="Toggle menu"
        >
          <Menu className="h-6 w-6" />
        </button>
      </div>

      {isOpen && (
        <div className="border-t border-zinc-800 bg-zinc-950 px-6 py-4 md:hidden">
          <nav className="flex flex-col gap-2 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-1">
            {navItems.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setIsOpen(false)}
                className={`rounded-xl px-4 py-3 text-sm font-medium transition ${
                  isActive(item.href)
                    ? "bg-violet-500/20 text-violet-200"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
