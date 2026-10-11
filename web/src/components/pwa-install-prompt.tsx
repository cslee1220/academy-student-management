"use client";

import { useEffect, useState } from "react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function PwaInstallPrompt() {
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);

  useEffect(() => {
    const initialStateTimer = window.setTimeout(() => {
      setIsStandalone(window.matchMedia("(display-mode: standalone)").matches || Boolean((window.navigator as Navigator & { standalone?: boolean }).standalone));
      setIsIos(/iphone|ipad|ipod/i.test(window.navigator.userAgent));
    }, 0);
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js");
    return () => {
      window.clearTimeout(initialStateTimer);
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    };
  }, []);

  async function installApp() {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
  }

  if (isStandalone) return null;
  if (!installEvent && !isIos) return null;

  return (
    <section className="mt-6 rounded-2xl border border-indigo-200 bg-indigo-50 p-5 text-sm text-indigo-950">
      <p className="font-bold">보호자 앱으로 편리하게 이용하세요</p>
      {installEvent ? (
        <button type="button" onClick={() => void installApp()} className="mt-3 rounded-xl bg-indigo-600 px-4 py-3 font-bold text-white hover:bg-indigo-700">
          앱 설치
        </button>
      ) : (
        <p className="mt-2 leading-6">Safari의 공유 버튼을 누른 뒤 <span className="font-bold">홈 화면에 추가</span>를 선택해 주세요.</p>
      )}
    </section>
  );
}
