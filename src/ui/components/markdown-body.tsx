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
        table: ({ children }) => (
          <div className="my-4 max-w-full overflow-x-auto overscroll-x-contain">
            <table className="w-max min-w-full">{children}</table>
          </div>
        ),
        pre: ({ children }) => (
          <CodeBlock className="my-4" preClassName="m-0 w-max min-w-full">
            {children}
          </CodeBlock>
        ),
      }}
    >
      {markdown}
    </ReactMarkdown>
  )
}
