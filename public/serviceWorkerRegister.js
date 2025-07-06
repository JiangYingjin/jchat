if ('serviceWorker' in navigator) {
  window.addEventListener('DOMContentLoaded', function () {
    console.log('[SW Register] Starting ServiceWorker registration...');

    navigator.serviceWorker.register('/serviceWorker.js').then(function (registration) {
      console.log('ServiceWorker registration successful with scope: ', registration.scope);

      // 检查是否有新版本
      registration.addEventListener('updatefound', function () {
        console.log('[SW Register] New ServiceWorker version found');
        const newWorker = registration.installing;

        if (newWorker) {
          newWorker.addEventListener('statechange', function () {
            console.log('[SW Register] New ServiceWorker state:', newWorker.state);

            if (newWorker.state === 'installed') {
              if (navigator.serviceWorker.controller) {
                console.log('[SW Register] New ServiceWorker installed, reloading page...');
                window.location.reload();
              } else {
                console.log('[SW Register] ServiceWorker installed for the first time');
              }
            }
          });
        }
      });

      // 立即检查更新
      registration.update().then(res => {
        console.log('[SW Register] Update check result:', res);
      });

      // 定期检查更新
      setInterval(() => {
        registration.update();
      }, 60000); // 每分钟检查一次

      // 查询 ServiceWorker 版本
      if (registration.active) {
        const messageChannel = new MessageChannel();
        messageChannel.port1.onmessage = function (event) {
          console.log('[SW Register] ServiceWorker version:', event.data.version);
          window._SW_VERSION = event.data.version;
        };

        registration.active.postMessage({ type: 'GET_VERSION' }, [messageChannel.port2]);
      }

      window._SW_ENABLED = true;
      console.log('[SW Register] ServiceWorker enabled');

    }, function (err) {
      console.error('ServiceWorker registration failed: ', err);
      window._SW_ENABLED = false; // 明确设置为 false
    });

    // 监听 ServiceWorker 控制器变化
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      console.log('[SW Register] ServiceWorker controller changed, reloading...');
      window.location.reload(true);
    });

    // 监听 ServiceWorker 消息
    navigator.serviceWorker.addEventListener('message', function (event) {
      console.log('[SW Register] Message from ServiceWorker:', event.data);
    });

  });
} else {
  console.log('ServiceWorker not supported');
  window._SW_ENABLED = false; // 如果不支持 ServiceWorker，设置为 false
}

// 提供手动更新函数
window.updateServiceWorker = function () {
  console.log('[SW Register] Manual update requested...');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      registrations.forEach(registration => {
        console.log('[SW Register] Updating registration:', registration.scope);
        registration.update();
      });
    });
  }
};

// 提供清除 ServiceWorker 的函数
window.clearServiceWorker = function () {
  console.log('[SW Register] Clearing ServiceWorker...');

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      return Promise.all(registrations.map(registration => {
        console.log('[SW Register] Unregistering:', registration.scope);
        return registration.unregister();
      }));
    }).then(() => {
      console.log('[SW Register] All ServiceWorkers cleared');
      window._SW_ENABLED = false;
      // 清除缓存
      return caches.keys().then(cacheNames => {
        return Promise.all(cacheNames.map(cacheName => {
          console.log('[SW Register] Deleting cache:', cacheName);
          return caches.delete(cacheName);
        }));
      });
    }).then(() => {
      console.log('[SW Register] All caches cleared, please refresh the page');
    });
  }
};
