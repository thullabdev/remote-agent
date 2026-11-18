# Git change comments, attached to a chat: design

Date: 2026-11-18
Status: approved in conversation (option 1: a text attachment on the chat's next message)
Builds on: [Git extension design](2026-11-17-git-extension-design.md)

## Intent

While reviewing changes, the person wants to note things on specific lines and then refer to those notes in the conversation with the agent. The notes must reach the Session, so they travel as an attachment on the next message, the same way an uploaded file does.

## How it works

1. In the diff panel, each line has a comment button in the gutter. Clicking it opens a small editor under that line. Saving stores the comment.
2. Comments are stored per chat in `localStorage` (like the open diff tabs), key `remote-agent.git.comments.v1`, shape `{ [chatId]: Comment[] }`.
3. A comment is anchored to: file path (repo-relative), diff scope (`staged`, `unstaged` or `commit`), commit sha when scope is `commit`, line number (new side for added and context lines, old side for removed lines), the line's text, the comment text, and the time.
4. The Git panel footer (and the diff panel footer) shows "N comments" with an **Attach to chat** button.
5. **Attach to chat** builds one markdown document from the chat's comments, grouped by file, and stores it as a **text attachment**. A text attachment is an upload record whose content is server-written text (mime `text/markdown`). It is created by a new endpoint, not by the upload route, so the upload route's type limit is unchanged.
6. The text attachment is added to the active chat's composer as a chip, exactly like a library upload. The person sends the message as usual. The Session receives the file path through the existing attachment listing.
7. After a successful attach, the comments for that chat are cleared, so they are not attached twice. The person can still open the attachment chip to read them.

## Decisions (my calls)

- **Text attachment = server-created upload record.** Reuses `UploadRef`, the library file store, the composer chip, `attachmentIds`, and the session path listing. No change to how the Session reads files.
- **Size cap:** 64 KB of text per attachment; 200 comments per attach. Over the cap, the attach is refused with a message saying what to trim.
- **Name:** `review-comments-<short-date>-<repo-branch>.md`, sanitised for the file system.
- **Composer access:** a small host module (`src/ui/composer-bus.ts`) lets an extension add an attachment to the active chat's composer. The composer subscribes for the chat it shows. If no chat is open, Attach is disabled with a hint.
- **Clearing:** comments clear only after the text attachment is created and added to the composer. If the person closes the chat without sending, the chip stays in the draft (drafts already save attachments).
- **Anchors are not revalidated.** A comment shows the line text it was made on. If the file has since changed, the comment still shows, with a muted "file changed since" note when the current diff no longer contains that line text. (Revalidation is a later task.)

## Not in this change

- Replying to a comment, resolving comments, or editing a saved comment after attach.
- Comments that the agent answers in-line. The agent reads the attachment; it does not write back.
- Sync across devices beyond what localStorage gives per browser.

## Parts

- Backend: a host route `POST /api/uploads/text` with `{ name, text }`. Validates the name, the 64 KB cap, and non-blank text. Stores it through a new `UploadLibrary.addText(name, text)` method, which skips the byte sniffing and the allowed-mime list that `add` applies, sets mime `text/markdown`, and returns an `UploadRef`. The upload route `POST /api/uploads` keeps its current checks. Tests with a temporary library.
- Host UI: `src/ui/composer-bus.ts` (subscribe and attach per chat id) and the composer subscription in `chat-composer.tsx`.
- Git extension: `comments.ts` (pure storage and markdown building, tested), `CommentEditor.tsx` (the gutter button and inline editor), changes to `DiffPanel.tsx` (gutter buttons, comments listed under lines), and the footer count and Attach button in `GitSideTab.tsx` and `DiffPanel.tsx`.
