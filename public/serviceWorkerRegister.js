if ('serviceWorker' in navigator) {
  window.addEventListener('DOMContentLoaded', function () {
    navigator.serviceWorker.register('/serviceWorker.js').then(function (registration) {
      // 检查是否有新版本
      registration.addEventListener('updatefound', function () {
        const newWorker = registration.installing;

        if (newWorker) {
          newWorker.addEventListener('statechange', function () {
            if (newWorker.state === 'installed') {
              if (navigator.serviceWorker.controller) {
                console.log('[SW] New version available, reloading...');
                window.location.reload();
              }
            }
          });
        }
      });

      // 立即检查更新
      registration.update();

      // 定期检查更新
      setInterval(() => {
        registration.update();
      }, 60000); // 每分钟检查一次

      // 查询 ServiceWorker 版本
      if (registration.active) {
        const messageChannel = new MessageChannel();
        messageChannel.port1.onmessage = function (event) {
          window._SW_VERSION = event.data.version;
        };

        registration.active.postMessage({ type: 'GET_VERSION' }, [messageChannel.port2]);
      }

      window._SW_ENABLED = true;

    }, function (err) {
      console.error('[SW] Registration failed:', err);
      window._SW_ENABLED = false;
    });

    // 监听 ServiceWorker 控制器变化
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      window.location.reload(true);
    });

  });
} else {
  window._SW_ENABLED = false;
}

// 提供手动更新函数
window.updateServiceWorker = function () {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      registrations.forEach(registration => {
        registration.update();
      });
    });
  }
};

// 提供清除 ServiceWorker 的函数
window.clearServiceWorker = function () {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(registrations => {
      return Promise.all(registrations.map(registration => {
        return registration.unregister();
      }));
    }).then(() => {
      window._SW_ENABLED = false;
      // 清除缓存
      return caches.keys().then(cacheNames => {
        return Promise.all(cacheNames.map(cacheName => {
          return caches.delete(cacheName);
        }));
      });
    }).then(() => {
      console.log('[SW] All data cleared, please refresh the page');
    });
  }
};
