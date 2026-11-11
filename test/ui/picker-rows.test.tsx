import { expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PICKER_VISIBLE, PickerRows } from '../../src/ui/components/picker-rows.tsx'
import { pickerWhen } from '../../src/ui/presentation.ts'

const now = new Date(2026, 10, 11, 15, 0).getTime()

test('a time reads Today or Yesterday, and older dates get the day and month', () => {
  expect(pickerWhen(new Date(2026, 10, 11, 14, 20).getTime(), now)).toBe('Today 14:20')
  expect(pickerWhen(new Date(2026, 10, 10, 9, 5).getTime(), now)).toBe('Yesterday 09:05')
  expect(pickerWhen(new Date(2026, 10, 2, 8, 0).getTime(), now)).toBe('2 Nov 08:00')
})

function rows(count: number, detail = 'Fix the billing export so it stops double counting refunds and other long text') {
  return Array.from({ length: count }, (_, choice) => ({ label: `2026-11-${10 - choice} · ${detail}`, choice, detail, at: now - choice * 3_600_000 }))
}

test('a history is two lines: its first message as the title, and the date under it', () => {
  const html = renderToStaticMarkup(createElement(PickerRows, { buttons: rows(2), onPick: async () => {}, now }))
  const title = html.indexOf('Fix the billing export')
  const date = html.indexOf('Today 14:00')
  expect(title).toBeGreaterThan(-1)
  expect(date).toBeGreaterThan(title)
  expect(html).not.toContain('2026-11-10 ·')
  expect(html).not.toContain('line-clamp-2')
  expect(html).not.toContain('rounded-md')
})

test('only the first five show, with a control to show the rest', () => {
  const html = renderToStaticMarkup(createElement(PickerRows, { buttons: rows(8), onPick: async () => {}, now }))
  expect(html.match(/<li[ >]/g)?.length).toBe(PICKER_VISIBLE + 1)
  expect(html).toContain('Show 3 more')
})

test('a project row shows its folder name and full path', () => {
  const html = renderToStaticMarkup(
    createElement(PickerRows, { buttons: [{ label: 'api', detail: '/home/u/Sites/api', choice: 0 }], onPick: async () => {}, now }),
  )
  expect(html).toContain('>api<')
  expect(html).toContain('/home/u/Sites/api')
  expect(html).not.toContain('Show ')
})
