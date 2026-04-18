"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode } from "react";
import type { LiveConnectionState } from "./use-live-snapshot";
import { ObserverLogo } from "./observer-logo";

type ObserverShellProps = {
  eyebrow: string;
  title: string;
  description: ReactNode;
  connectionState: LiveConnectionState;
  headerActions?: ReactNode;
  children: ReactNode;
};

function liveIndicatorClass(state: LiveConnectionState) {
  if (state === "live") return "bg-emerald-500/12 text-emerald-200 ring-1 ring-emerald-400/25";
  if (state === "reconnecting") {
    return "bg-amber-500/12 text-amber-200 ring-1 ring-amber-400/25";
  }
  if (state === "polling") return "bg-sky-500/12 text-sky-200 ring-1 ring-sky-400/25";
  return "bg-white/6 text-slate-300 ring-1 ring-white/8";
}

function liveIndicatorLabel(state: LiveConnectionState) {
  if (state === "live") return "Realtime connected";
  if (state === "reconnecting") return "Reconnecting";
  if (state === "polling") return "Polling fallback";
  return "Connecting";
}

export function ObserverShell({
  eyebrow,
  title,
  description,
  connectionState,
  headerActions,
  children,
}: ObserverShellProps) {
  const pathname = usePathname();
  const navItems = [
    {
      href: "/",
      label: "Overview",
      description: "Current PR and latest decision",
      active: pathname === "/",
    },
    {
      href: pathname.startsWith("/reviews/") ? pathname : "/#history",
      label: pathname.startsWith("/reviews/") ? "Run Details" : "History",
      description: pathname.startsWith("/reviews/")
        ? "Deep triage and publication context"
        : "Recent review runs",
      active: pathname.startsWith("/reviews/"),
    },
  ];

  return (
    <div className="observer-shell">
      <aside className="observer-sidebar">
        <div className="observer-sidebar-inner">
          <Link href="/" className="rounded-3xl p-1">
            <ObserverLogo />
          </Link>

          <div className="mt-8 space-y-2">
            {navItems.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className={`observer-nav-link ${item.active ? "observer-nav-link-active" : ""}`}
              >
                <div className="text-sm font-medium text-slate-100">{item.label}</div>
                <div className="mt-1 text-xs text-slate-400">{item.description}</div>
              </Link>
            ))}
          </div>

          <div className="mt-8 observer-panel p-4">
            <div className="observer-kicker">Automation</div>
            <div className="mt-3 space-y-3 text-sm text-slate-300">
              <div className="flex items-start justify-between gap-3">
                <span>Publish policy</span>
                <span className="rounded-full border border-emerald-400/20 bg-emerald-500/10 px-2 py-1 text-[11px] font-medium text-emerald-200">
                  Auto
                </span>
              </div>
              <div className="flex items-start justify-between gap-3">
                <span>Merge guard</span>
                <span className="rounded-full border border-amber-400/20 bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-200">
                  High signal
                </span>
              </div>
              <div className="flex items-start justify-between gap-3">
                <span>Realtime sync</span>
                <span
                  className={`rounded-full px-2 py-1 text-[11px] font-medium ${liveIndicatorClass(
                    connectionState
                  )}`}
                >
                  {liveIndicatorLabel(connectionState)}
                </span>
              </div>
            </div>
          </div>

          <div className="mt-4 observer-subtle-panel p-4 text-sm text-slate-400">
            GitHub is the first stop for conversation. Observer keeps the publication context,
            skipped anchors, and run-to-run story.
          </div>
        </div>
      </aside>

      <div className="observer-content">
        <header className="observer-topbar">
          <div className="min-w-0">
            <div className="observer-kicker">{eyebrow}</div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-[2.4rem]">
              {title}
            </h1>
            <div className="mt-3 max-w-4xl text-sm leading-7 text-slate-300">{description}</div>
          </div>

          {headerActions ? (
            <div className="flex w-full flex-wrap items-start justify-start gap-2 lg:w-auto lg:justify-end">
              {headerActions}
            </div>
          ) : null}
        </header>

        <div className="observer-page">{children}</div>
      </div>
    </div>
  );
}
