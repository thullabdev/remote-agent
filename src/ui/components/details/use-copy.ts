import { useEffect, useRef, useState } from 'react'
import { copyToClipboard } from '../code-block.tsx'

/** Copies text and remembers which control was copied, for a moment, so it can show a check. */
export function useCopy(onNotify: (message: string) => void): { copied: string | null; copy(key: string, text: string): Promise<void> } {
  const [copied, setCopied] = useState<string | null>(null)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const copy = async (key: string, text: string) => {
    if (!(await copyToClipboard(text))) {
      onNotify('Could not copy. Select the text and copy it by hand.')
      return
    }
    setCopied(key)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(null), 1500)
  }
  return { copied, copy }
}
