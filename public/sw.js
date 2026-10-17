// Service worker: only shows reminder notifications and opens the app when tapped.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = { title: "日语练习", body: "今天练一下吧" };
  try {
    data = event.data.json();
  } catch {}
  event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: "/apple-icon", tag: "reminder" }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: "window" }).then((list) => {
      for (const c of list) if ("focus" in c) return c.focus();
      return self.clients.openWindow("/speak");
    }),
  );
});
