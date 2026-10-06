import Link from "next/link";

import AnnouncementFeed from "@/components/announcement-feed";
import NotificationsPanel from "@/components/notifications-panel";

export default function ParentAnnouncementsPage() {
  return <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="text-sm font-bold text-indigo-600">PARENT COMMUNICATION</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-950">보호자 공지·알림</h1></div><Link href="/parent" className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700">보호자 홈</Link></div><AnnouncementFeed endpoint="/api/guardian/announcements" title="보호자 공지사항" /><NotificationsPanel /></main>;
}
