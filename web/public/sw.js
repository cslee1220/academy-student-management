const SHELL_CACHE = "academy-shell-v10";
const ASSET_CACHE = "academy-assets-v10";
const SHELL_URLS = ["/", "/offline", "/manifest.webmanifest", "/academy-icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_URLS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((cacheNames) => Promise.all(cacheNames
    .filter((cacheName) => (cacheName.startsWith("academy-shell-") || cacheName.startsWith("academy-assets-")) && cacheName !== SHELL_CACHE && cacheName !== ASSET_CACHE)
    .map((cacheName) => caches.delete(cacheName)))
    .then(() => self.clients.claim())));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return;

  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/offline")));
    return;
  }

  const isStaticAsset = ["script", "style", "image", "font"].includes(event.request.destination);
  if (!isStaticAsset) return;
  event.respondWith(caches.match(event.request).then((cached) => cached ?? fetch(event.request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      void caches.open(ASSET_CACHE).then((cache) => cache.put(event.request, copy));
    }
    return response;
  })));
});

self.addEventListener("push", (event) => {
  let payload = { title: "학원 알림", body: "새로운 알림이 있습니다.", url: "/parent" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // Ignore malformed push payloads and show the safe fallback message.
  }
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: "/academy-icon.svg",
    badge: "/academy-icon.svg",
    data: { url: payload.url },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.notification.data?.url || "/parent";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => "focus" in client);
    if (existing) {
      if ("navigate" in existing) void existing.navigate(target);
      return existing.focus();
    }
    return self.clients.openWindow(target);
  }));
});
