import type { Metadata } from "next";
import Link from "next/link";
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
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <Link href="/" className="text-lg font-bold tracking-tight text-slate-900">
              학원 학생관리 PWA
            </Link>
            <nav aria-label="주요 메뉴" className="flex gap-2 text-sm font-medium">
              <Link className="rounded-full px-3 py-2 text-slate-600 hover:bg-slate-100" href="/admin">
                운영자
              </Link>
              <Link className="rounded-full px-3 py-2 text-slate-600 hover:bg-slate-100" href="/teacher">
                교사
              </Link>
              <Link className="rounded-full px-3 py-2 text-slate-600 hover:bg-slate-100" href="/parent">
                학부모
              </Link>
              <Link className="rounded-full px-3 py-2 text-indigo-600 hover:bg-indigo-50" href="/login">
                로그인
              </Link>
            </nav>
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="border-t border-slate-200 bg-white">
          <div className="mx-auto max-w-6xl px-6 py-5 text-sm text-slate-500">
            현재는 화면 구조를 확인하는 초기 단계입니다.
          </div>
        </footer>
      </body>
    </html>
  );
}
