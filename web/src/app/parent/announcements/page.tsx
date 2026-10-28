import Link from "next/link";

import AnnouncementFeed from "@/components/announcement-feed";
import NotificationsPanel from "@/components/notifications-panel";

const focusRingClass = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2";

export default function ParentAnnouncementsPage() {
  return <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm font-bold text-indigo-600">PARENT COMMUNICATION</p><h1 className="mt-2 break-words text-3xl font-bold tracking-tight text-slate-950">보호자 공지·알림</h1><p className="mt-2 text-sm leading-6 text-slate-600">학원에서 보호자에게 공개한 공지와 내 알림을 확인합니다.</p></div><Link href="/parent" className={`min-h-11 rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 ${focusRingClass}`}>보호자 홈</Link></div><AnnouncementFeed endpoint="/api/guardian/announcements" title="보호자 공지사항" /><NotificationsPanel /></main>;
}
