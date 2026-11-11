import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from './code-block.tsx'

export default function MarkdownBody({ markdown }: { markdown: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer noopener">
            {children}
          </a>
        ),
        // Cells wrap their text; a column never gets narrower than 6rem, so a wide table scrolls inside its own wrapper.
        table: ({ children }) => (
          <div className="my-4 max-w-full overflow-x-auto overscroll-x-contain">
            <table className="w-full [&_td]:min-w-24 [&_td]:align-top [&_th]:min-w-24 [&_th]:align-top">{children}</table>
          </div>
        ),
        // The frame belongs to the wrapper and the code scrolls inside it, so the box stays put while long lines move.
        pre: ({ children }) => (
          <CodeBlock className="not-prose my-4 overflow-hidden rounded-xl border border-border bg-muted" preClassName="m-0 w-max min-w-full p-3 pr-11 font-mono text-[.875em] leading-relaxed">
            {children}
          </CodeBlock>
        ),
      }}
    >
      {markdown}
    </ReactMarkdown>
  )
}
