const CACHE="miqyas-v1-21-2-push-2";
const ASSETS=["./","./index.html","./app.js","./style.css","./config.js","./manifest.webmanifest","./icon.svg"];
self.addEventListener("install",e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS))));
self.addEventListener("activate",e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))));
self.addEventListener("fetch",e=>{if(e.request.method!=="GET")return;const u=new URL(e.request.url);if(u.origin!==location.origin)return;e.respondWith(caches.match(e.request).then(c=>c||fetch(e.request).then(r=>{if(r.ok){const copy=r.clone();caches.open(CACHE).then(cache=>cache.put(e.request,copy));}return r;})));});
self.addEventListener("push",event=>{
  let payload={};
  try{payload=event.data?event.data.json():{};}catch(_){payload={body:event.data?.text?.()||"وصل تحديث جديد إلى MIQYAS."};}
  const title=payload.title||"إشعار جديد من MIQYAS";
  const options={body:payload.body||"لديك تحديث جديد.",icon:"./icon.svg",badge:"./icon.svg",tag:payload.tag||"miqyas-update",data:{url:payload.url||"./"},renotify:false};
  event.waitUntil(self.registration.showNotification(title,options));
});
self.addEventListener("notificationclick",e=>{e.notification.close();const target=new URL(e.notification.data?.url||"./",self.location.origin).href;e.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(list=>{for(const client of list){if(client.url.startsWith(self.location.origin)&&"focus" in client){client.navigate(target);return client.focus();}}return clients.openWindow(target);}));});
