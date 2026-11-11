import { useState, type CSSProperties, type ImgHTMLAttributes } from 'react'
import { cn } from '../../lib/utils.ts'

type AvatarProps = ImgHTMLAttributes<HTMLImageElement> & {
  fallback: string
  /** 0-359. Tints the letter tile so a project is recognisable by color. Without it the tile is the neutral muted fill. */
  hue?: number
}

export function Avatar({ className, fallback, hue, src, alt = '', ...props }: AvatarProps) {
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
    <span
      className={cn(
        'grid size-10 shrink-0 place-items-center rounded-xl bg-muted font-display font-semibold text-muted-foreground',
        hue !== undefined && 'bg-[hsl(var(--avatar-hue)_45%_50%/0.18)] text-[hsl(var(--avatar-hue)_60%_30%)] dark:text-[hsl(var(--avatar-hue)_75%_80%)]',
        className,
      )}
      style={hue === undefined ? undefined : ({ '--avatar-hue': hue } as CSSProperties)}
      aria-hidden="true"
    >
      {fallback.slice(0, 1).toUpperCase()}
    </span>
  )
}
