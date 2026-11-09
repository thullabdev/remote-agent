const CACHE_NAME = 'remote-agent-shell-v21'

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const response = await fetch('/')
    if (!response.ok) {
      throw new Error(`Could not fetch the app shell (${response.status}).`)
    }

    const cache = await caches.open(CACHE_NAME)
    await cache.put('/', response.clone())
    const html = await response.text()
    const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css)(?:\?[^"]*)?)"/g)]
      .map(match => match[1])
      .filter(url => url !== undefined && url.startsWith('/'))
    await cache.addAll([
      '/manifest.webmanifest',
      '/icon.svg',
      '/icon-180.png',
      '/icon-192.png',
      '/icon-512.png',
      ...assets,
    ])
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys
      .filter(key => key.startsWith('remote-agent-shell-') && key !== CACHE_NAME)
      .map(key => caches.delete(key)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) {
    return
  }
  if (url.pathname.startsWith('/api/') || url.pathname === '/ws') {
    return
  }

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request)
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME)
          await cache.put('/', response.clone())
        }
        return response
      } catch {
        const cache = await caches.open(CACHE_NAME)
        const cached = await cache.match('/')
        return cached ?? new Response('Remote Agent is offline. Reconnect to load the app.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        })
      }
    })())
    return
  }

  if (!url.pathname.startsWith('/assets/') && ![
    '/manifest.webmanifest',
    '/icon.svg',
    '/icon-180.png',
    '/icon-192.png',
    '/icon-512.png',
  ].includes(url.pathname)) {
    return
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME)
    const cached = await cache.match(request)
    if (cached !== undefined) {
      return cached
    }
    const response = await fetch(request)
    if (response.ok) {
      await cache.put(request, response.clone())
    }
    return response
  })())
})

self.addEventListener('push', event => {
  if (!event.data) {
    return
  }
  let payload
  try {
    payload = event.data.json()
  } catch {
    payload = { title: 'Remote Agent', preview: event.data.text(), chatId: 'general' }
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'Remote Agent', {
      body: payload.preview || 'A Session needs your attention.',
      tag: payload.chatId || 'remote-agent',
      data: { chatId: payload.chatId || 'general', promptId: payload.promptId || null },
      icon: '/icon.svg',
      badge: '/icon.svg',
    }),
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const chatId = event.notification.data?.chatId || 'general'
  const promptId = event.notification.data?.promptId
  // A prompt notification opens the chat scrolled to the prompt that is waiting.
  const query = `chat=${encodeURIComponent(chatId)}${promptId ? `&prompt=${encodeURIComponent(promptId)}` : ''}`
  const target = new URL(`/?${query}`, self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const windowClient = clients.find(client => client.url.startsWith(self.location.origin))
      if (windowClient && 'focus' in windowClient) {
        return windowClient.navigate(target).then(client => client?.focus())
      }
      return self.clients.openWindow(target)
    }),
  )
})
