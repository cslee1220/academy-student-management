"use client";

import { useEffect } from "react";

const APP_CACHE_PREFIXES = ["academy-shell-", "academy-assets-"];

export default function LocalDevCacheCleanup() {
  useEffect(() => {
    if (window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") return;
    if (!("serviceWorker" in navigator)) return;

    void navigator.serviceWorker.getRegistrations().then(async (registrations) => {
      await Promise.all(registrations.map((registration) => registration.unregister()));
      if (!("caches" in window)) return;

      const cacheNames = await caches.keys();
      await Promise.all(cacheNames
        .filter((cacheName) => APP_CACHE_PREFIXES.some((prefix) => cacheName.startsWith(prefix)))
        .map((cacheName) => caches.delete(cacheName)));
    });
  }, []);

  return null;
}
