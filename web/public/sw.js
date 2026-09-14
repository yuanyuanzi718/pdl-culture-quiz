// 仅建立 PWA 生命周期，不缓存页面或 API 数据，避免题目、权限和版本被旧缓存覆盖。
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
