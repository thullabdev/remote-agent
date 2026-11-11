import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Toast, toastDuration } from '../../src/ui/components/toast.tsx'

const render = (kind: 'success' | 'error', message = 'Session pinned.'): string =>
  renderToStaticMarkup(createElement(Toast, { toast: { id: 1, message, kind }, onDismiss: () => {} }))

test('a confirmation is announced politely and uses the app card with a green icon', () => {
  const markup = render('success')
  expect(markup).toContain('role="status"')
  expect(markup).toContain('aria-live="polite"')
  expect(markup).toContain('bg-card')
  expect(markup).toContain('text-emerald-700')
  expect(markup).toContain('Session pinned.')
})

test('an error is announced at once and is visibly different from a confirmation', () => {
  const markup = render('error', 'You can pin up to 5 Sessions.')
  expect(markup).toContain('role="alert"')
  expect(markup).toContain('aria-live="assertive"')
  expect(markup).toContain('text-red-600')
  expect(markup).toContain('ring-red-500/40')
  expect(markup).not.toContain('text-emerald-700')
})

test('on a phone the toast sits at the top inside the safe area, and moves to the bottom on wide screens', () => {
  const markup = render('success')
  expect(markup).toContain('top-[max(.75rem,env(safe-area-inset-top))]')
  expect(markup).toContain('md:bottom-6')
  expect(markup).not.toContain('bottom-5')
})

test('the dismiss control is a thumb-sized target with a label', () => {
  const markup = render('success')
  expect(markup).toContain('aria-label="Dismiss notification"')
  expect(markup).toContain('size-9')
})

test('errors stay longer than confirmations', () => {
  expect(toastDuration('error')).toBeGreaterThan(toastDuration('success'))
})
