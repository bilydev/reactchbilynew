/* Service worker kecil — hanya untuk menampilkan notifikasi owner (wajib di Android Chrome). Tidak menyimpan cache. */
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('notificationclick',e=>{
  e.notification.close();
  e.waitUntil((async()=>{
    const list=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const c of list){ if('focus' in c){ await c.focus(); return } }
    if(self.clients.openWindow) await self.clients.openWindow(self.registration.scope);
  })());
});
