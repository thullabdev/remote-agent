import { useCallback, useEffect, useState } from 'react'
import type { ApiClient } from './api.ts'
import { isDesktopApp } from './platform.ts'
import type { PushSubscriptionRecord } from '../channel/web/protocol.ts'

export type PushStatus = {
  supported: boolean
  desktopApp: boolean
  subscribed: boolean
  permission: NotificationPermission | 'unsupported'
  iosHomeScreenRequired: boolean
}

function isIosSafariNotInstalled(): boolean {
  const userAgent = navigator.userAgent
  const iosSafari = /iPad|iPhone|iPod/.test(userAgent) && /Safari/.test(userAgent) && !/CriOS|FxiOS|EdgiOS/.test(userAgent)
  const standalone = window.matchMedia('(display-mode: standalone)').matches || ('standalone' in navigator && navigator.standalone === true)
  return iosSafari && !standalone
}

function decodeApplicationKey(encoded: string): Uint8Array<ArrayBuffer> {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
  const bytes = Uint8Array.from(atob(padded), character => character.charCodeAt(0))
  return bytes
}

function toSubscriptionRecord(subscription: PushSubscription): PushSubscriptionRecord {
  const value = subscription.toJSON()
  if (!value.endpoint || !value.keys?.p256dh || !value.keys.auth) {
    throw new Error('The browser returned an incomplete push subscription.')
  }
  return { endpoint: value.endpoint, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } }
}

export function usePushSubscription(api: ApiClient) {
  const desktopApp = isDesktopApp()
  const supported = !desktopApp && typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  const [status, setStatus] = useState<PushStatus>({
    supported,
    desktopApp,
    subscribed: false,
    permission: supported ? Notification.permission : 'unsupported',
    iosHomeScreenRequired: !desktopApp && typeof navigator !== 'undefined' && isIosSafariNotInstalled(),
  })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!supported) {
      return
    }
    let active = true
    void navigator.serviceWorker.getRegistration('/').then(async registration => {
      if (registration === undefined) {
        return null
      }
      return registration.pushManager.getSubscription()
    }).then(subscription => {
      if (active) {
        setStatus(current => ({ ...current, subscribed: subscription !== null, permission: Notification.permission }))
      }
    }).catch(() => {
      if (active) {
        setStatus(current => ({ ...current, subscribed: false, permission: Notification.permission }))
      }
    })
    return () => { active = false }
  }, [supported])

  const enable = useCallback(async () => {
    if (!supported) {
      throw new Error('Push notifications are not supported by this browser.')
    }
    setBusy(true)
    try {
      const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission
      setStatus(current => ({ ...current, permission }))
      if (permission !== 'granted') {
        throw new Error(permission === 'denied' ? 'Notifications are blocked in browser settings.' : 'Notification permission was not granted.')
      }
      const registration = await navigator.serviceWorker.register('/sw.js')
      let subscription = await registration.pushManager.getSubscription()
      if (subscription === null) {
        const { key } = await api.getPushKey()
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: decodeApplicationKey(key),
        })
      }
      await api.subscribePush(toSubscriptionRecord(subscription))
      setStatus(current => ({ ...current, subscribed: true, permission }))
    } finally {
      setBusy(false)
    }
  }, [api, supported])

  const disable = useCallback(async () => {
    setBusy(true)
    try {
      const registration = await navigator.serviceWorker.getRegistration('/')
      const subscription = await registration?.pushManager.getSubscription()
      if (subscription !== null && subscription !== undefined) {
        await api.unsubscribePush(subscription.endpoint)
        await subscription.unsubscribe()
      }
      setStatus(current => ({ ...current, subscribed: false }))
    } finally {
      setBusy(false)
    }
  }, [api])

  return { status, busy, enable, disable }
}
