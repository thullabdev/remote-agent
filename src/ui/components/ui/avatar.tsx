import { useState, type ImgHTMLAttributes } from 'react'
import { cn } from '../../lib/utils.ts'

type AvatarProps = ImgHTMLAttributes<HTMLImageElement> & { fallback: string }

export function Avatar({ className, fallback, src, alt = '', ...props }: AvatarProps) {
  const [failed, setFailed] = useState(false)
  return src && !failed ? (
    <img
      src={src}
      alt={alt}
      className={cn('size-10 shrink-0 rounded-xl bg-muted object-cover', className)}
      onError={() => setFailed(true)}
      {...props}
    />
  ) : (
    <span className={cn('grid size-10 shrink-0 place-items-center rounded-xl border border-border bg-muted font-display font-semibold text-muted-foreground', className)} aria-hidden="true">
      {fallback.slice(0, 1).toUpperCase()}
    </span>
  )
}
