import { Check, Copy } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '../lib/utils.ts'
import { Button } from './ui/button.tsx'

type ClipboardLike = { writeText(text: string): Promise<void> }

// The async clipboard API only exists on secure origins; over plain http on a LAN the old selection-based copy still works.
function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined') {
    return false
  }
  const field = document.createElement('textarea')
  field.value = text
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.appendChild(field)
  field.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    field.remove()
  }
}

export async function copyToClipboard(text: string, clipboard: ClipboardLike | undefined = globalThis.navigator?.clipboard): Promise<boolean> {
  if (clipboard !== undefined) {
    try {
      await clipboard.writeText(text)
      return true
    } catch {
      // Fall through to the legacy copy below.
    }
  }
  return legacyCopy(text)
}

type CodeBlockProps = {
  children: ReactNode
  className?: string
  preClassName?: string
}

export function CodeBlock({ children, className, preClassName }: CodeBlockProps) {
  const preRef = useRef<HTMLPreElement>(null)
  const resetTimer = useRef<number | undefined>(undefined)
  const [copied, setCopied] = useState(false)

  useEffect(() => () => window.clearTimeout(resetTimer.current), [])

  const copy = async () => {
    const copiedOk = await copyToClipboard(preRef.current?.textContent ?? '')
    if (!copiedOk) {
      return
    }
    setCopied(true)
    window.clearTimeout(resetTimer.current)
    resetTimer.current = window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={cn('relative min-w-0 max-w-full', className)}>
      <div className="max-w-full overflow-x-auto overscroll-x-contain">
        <pre ref={preRef} className={preClassName}>{children}</pre>
      </div>
      <Button
        variant="outline"
        size="icon-sm"
        aria-label={copied ? 'Code copied' : 'Copy code'}
        title={copied ? 'Copied' : 'Copy code'}
        className="absolute right-2 top-2 z-10 size-7 bg-card/90 text-muted-foreground shadow-sm backdrop-blur-sm hover:text-foreground [&_svg]:size-3.5"
        onClick={() => void copy()}
      >
        {copied ? <Check /> : <Copy />}
      </Button>
    </div>
  )
}
