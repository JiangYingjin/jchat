// ServiceWorker 版本: 1.0.2 - 2024-07-06
const CHATGPT_NEXT_WEB_CACHE = "chatgpt-next-web-cache-v1.0.2";
const CHATGPT_NEXT_WEB_FILE_CACHE = "chatgpt-next-web-file-v1.0.2";
const SW_VERSION = "1.0.2";

let a = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
let nanoid = (e = 21) => {
  let t = "",
    r = crypto.getRandomValues(new Uint8Array(e));
  for (let n = 0; n < e; n++) t += a[63 & r[n]];
  return t;
};

self.addEventListener("activate", function (event) {
  // 清除旧版本的缓存
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (
              cacheName !== CHATGPT_NEXT_WEB_CACHE &&
              cacheName !== CHATGPT_NEXT_WEB_FILE_CACHE
            ) {
              return caches.delete(cacheName);
            }
          }),
        );
      })
      .then(() => {
        // 立即接管所有客户端
        return self.clients.claim();
      }),
  );
});

self.addEventListener("install", function (event) {
  self.skipWaiting(); // 立即激活新版本
  event.waitUntil(
    caches.open(CHATGPT_NEXT_WEB_CACHE).then(function (cache) {
      return cache.addAll([]);
    }),
  );
});

function jsonify(data) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json" },
  });
}

async function upload(request, url) {
  try {
    const formData = await request.formData();
    const file = formData.getAll("file")[0];

    if (!file) {
      console.error("[SW] No file found in formData");
      return jsonify({ code: 1, msg: "No file provided" });
    }

    let ext = file.name.split(".").pop();
    if (ext === "blob") {
      ext = file.type.split("/").pop();
    }

    const fileUrl = `${url.origin}/api/cache/${nanoid()}.${ext}`;

    const cache = await caches.open(CHATGPT_NEXT_WEB_FILE_CACHE);
    await cache.put(
      new Request(fileUrl),
      new Response(file, {
        headers: {
          "content-type": file.type,
          "content-length": file.size.toString(),
          "cache-control": "no-cache",
          server: `ServiceWorker-v${SW_VERSION}`,
        },
      }),
    );

    return jsonify({ code: 0, data: fileUrl });
  } catch (error) {
    console.error("[SW] Upload error:", error);
    return jsonify({ code: 1, msg: error.message });
  }
}

async function remove(request, url) {
  try {
    const cache = await caches.open(CHATGPT_NEXT_WEB_FILE_CACHE);
    const res = await cache.delete(request.url);
    return jsonify({ code: 0 });
  } catch (error) {
    console.error("[SW] Remove error:", error);
    return jsonify({ code: 1, msg: error.message });
  }
}

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // 修复路径匹配逻辑
  if (url.pathname.startsWith("/api/cache")) {
    if (e.request.method === "GET") {
      e.respondWith(
        caches.match(e.request).then((response) => {
          if (response) {
            return response;
          }
          return new Response("File not found", { status: 404 });
        }),
      );
      return; // 重要：防止继续执行
    }

    if (e.request.method === "POST") {
      e.respondWith(upload(e.request, url));
      return; // 重要：防止继续执行
    }

    if (e.request.method === "DELETE") {
      e.respondWith(remove(e.request, url));
      return; // 重要：防止继续执行
    }
  }
});

// 版本信息查询
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "GET_VERSION") {
    event.ports[0].postMessage({ version: SW_VERSION });
  }
});
