import type { Metadata } from "next";
import Link from "next/link";
import LocalDevCacheCleanup from "@/components/local-dev-cache-cleanup";
import "./globals.css";

export const metadata: Metadata = {
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/academy-icon.svg",
  },
  title: "학원 학생관리 PWA",
  description: "학원 학생관리 PWA의 초기 화면",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full bg-slate-50 text-slate-950">
        <LocalDevCacheCleanup />
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-6 sm:py-4">
            <Link href="/" className="w-fit whitespace-nowrap text-lg font-bold tracking-tight text-slate-900">
              학원 학생관리 PWA
            </Link>
            <nav aria-label="주요 메뉴" className="flex w-full items-center justify-between gap-0 text-sm font-medium sm:w-auto sm:justify-start sm:gap-2 sm:flex-nowrap">
              <Link className="inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full px-2 py-2 text-slate-600 hover:bg-slate-100 sm:px-3" href="/admin">
                운영자
              </Link>
              <Link className="inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full px-2 py-2 text-slate-600 hover:bg-slate-100 sm:px-3" href="/teacher">
                교사
              </Link>
              <Link className="inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full px-2 py-2 text-slate-600 hover:bg-slate-100 sm:px-3" href="/parent">
                학부모
              </Link>
              <Link className="inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full px-2 py-2 text-indigo-600 hover:bg-indigo-50 sm:px-3" href="/login">
                로그인
              </Link>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
