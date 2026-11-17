import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { BranchLine } from './GitSideTab.tsx'

test('shows the branch name and its upstream', () => {
  const html = renderToStaticMarkup(<BranchLine branch="main" upstream="origin/main" />)
  expect(html).toContain('main')
  expect(html).toContain('origin/main')
})

test('a detached HEAD says so and shows no upstream', () => {
  const html = renderToStaticMarkup(<BranchLine branch={null} upstream={null} />)
  expect(html).toContain('Detached HEAD')
  expect(html).not.toContain('·')
})

test('shows ahead and behind counts with their titles', () => {
  const html = renderToStaticMarkup(<BranchLine branch="main" upstream="origin/main" ahead={2} behind={1} />)
  expect(html).toContain('title="2 commits to push">↑2</span>')
  expect(html).toContain('title="1 commit to pull">↓1</span>')
})

test('a count of one uses the singular and a zero count shows nothing', () => {
  const html = renderToStaticMarkup(<BranchLine branch="main" upstream="origin/main" ahead={1} behind={0} />)
  expect(html).toContain('1 commit to push')
  expect(html).not.toContain('↓')
  expect(html).not.toContain('to pull')
})

test('both counts at zero show no arrows', () => {
  const html = renderToStaticMarkup(<BranchLine branch="main" upstream="origin/main" ahead={0} behind={0} />)
  expect(html).not.toContain('↑')
  expect(html).not.toContain('↓')
})
