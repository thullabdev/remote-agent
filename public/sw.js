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
      data: { chatId: payload.chatId || 'general' },
      icon: '/icon.svg',
      badge: '/icon.svg',
    }),
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const chatId = event.notification.data?.chatId || 'general'
  const target = new URL(`/?chat=${encodeURIComponent(chatId)}`, self.location.origin).href
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
