// ServiceWorker 版本: 1.0.2 - 2024-07-06
const CHATGPT_NEXT_WEB_CACHE = "chatgpt-next-web-cache-v1.0.2";
const CHATGPT_NEXT_WEB_FILE_CACHE = "chatgpt-next-web-file-v1.0.2";
const SW_VERSION = "1.0.2";

let a = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict"; let nanoid = (e = 21) => { let t = "", r = crypto.getRandomValues(new Uint8Array(e)); for (let n = 0; n < e; n++)t += a[63 & r[n]]; return t };

console.log(`[ServiceWorker] Version ${SW_VERSION} initializing...`);

self.addEventListener("activate", function (event) {
  console.log(`[ServiceWorker] Version ${SW_VERSION} activated.`);
  // 清除旧版本的缓存
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CHATGPT_NEXT_WEB_CACHE && cacheName !== CHATGPT_NEXT_WEB_FILE_CACHE) {
            console.log(`[ServiceWorker] Deleting old cache: ${cacheName}`);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => {
      // 立即接管所有客户端
      return self.clients.claim();
    })
  );
});

self.addEventListener("install", function (event) {
  console.log(`[ServiceWorker] Version ${SW_VERSION} installing...`);
  self.skipWaiting();  // 立即激活新版本
  event.waitUntil(
    caches.open(CHATGPT_NEXT_WEB_CACHE).then(function (cache) {
      return cache.addAll([]);
    }),
  );
});

function jsonify(data) {
  return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })
}

async function upload(request, url) {
  try {
    console.log(`[ServiceWorker v${SW_VERSION}] Upload request received:`, url.pathname);
    console.log(`[ServiceWorker] Request method:`, request.method);
    console.log(`[ServiceWorker] Request URL:`, request.url);

    const formData = await request.formData()
    const file = formData.getAll('file')[0]

    if (!file) {
      console.error('[ServiceWorker] No file found in formData');
      return jsonify({ code: 1, msg: 'No file provided' });
    }

    console.log(`[ServiceWorker] File details:`, {
      name: file.name,
      size: file.size,
      type: file.type
    });

    let ext = file.name.split('.').pop()
    if (ext === 'blob') {
      ext = file.type.split('/').pop()
    }

    const fileUrl = `${url.origin}/api/cache/${nanoid()}.${ext}`
    console.log('[ServiceWorker] Generated file URL:', fileUrl);

    const cache = await caches.open(CHATGPT_NEXT_WEB_FILE_CACHE)
    await cache.put(new Request(fileUrl), new Response(file, {
      headers: {
        'content-type': file.type,
        'content-length': file.size.toString(),
        'cache-control': 'no-cache',
        'server': `ServiceWorker-v${SW_VERSION}`,
      }
    }))

    console.log('[ServiceWorker] File cached successfully:', fileUrl);
    return jsonify({ code: 0, data: fileUrl })
  } catch (error) {
    console.error('[ServiceWorker] Upload error:', error);
    return jsonify({ code: 1, msg: error.message });
  }
}

async function remove(request, url) {
  try {
    console.log(`[ServiceWorker v${SW_VERSION}] Remove request received:`, url.pathname);
    const cache = await caches.open(CHATGPT_NEXT_WEB_FILE_CACHE)
    const res = await cache.delete(request.url)
    console.log('[ServiceWorker] File removed:', request.url, res);
    return jsonify({ code: 0 })
  } catch (error) {
    console.error('[ServiceWorker] Remove error:', error);
    return jsonify({ code: 1, msg: error.message });
  }
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // 添加详细的调试信息
  if (url.pathname.includes('/api/cache')) {
    console.log(`[ServiceWorker v${SW_VERSION}] Intercepted request:`, {
      method: e.request.method,
      url: e.request.url,
      pathname: url.pathname
    });
  }

  // 修复路径匹配逻辑
  if (url.pathname.startsWith('/api/cache')) {
    console.log(`[ServiceWorker v${SW_VERSION}] Handling cache request:`, e.request.method, url.pathname);

    if (e.request.method === 'GET') {
      e.respondWith(
        caches.match(e.request).then(response => {
          if (response) {
            console.log('[ServiceWorker] Cache hit:', url.pathname);
            return response;
          }
          console.log('[ServiceWorker] Cache miss:', url.pathname);
          return new Response('File not found', { status: 404 });
        })
      );
      return; // 重要：防止继续执行
    }

    if (e.request.method === 'POST') {
      console.log('[ServiceWorker] Handling POST request for upload');
      e.respondWith(upload(e.request, url));
      return; // 重要：防止继续执行
    }

    if (e.request.method === 'DELETE') {
      console.log('[ServiceWorker] Handling DELETE request');
      e.respondWith(remove(e.request, url));
      return; // 重要：防止继续执行
    }
  }
});

// 版本信息查询
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({ version: SW_VERSION });
  }
});
