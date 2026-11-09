# File and Image Upload — Plan

**Status:** implemented on `main` (uploads, the library picker and `@` references). The API matches the plan, plus `POST /api/uploads/:id/thumbnail`, which lets the client store the preview it generates. The decisions below still hold. The web channel developer guide documents the shipped API.

## Goal

From the web chat, refer to an image or PDF in a message. The Session receives its path and can read it. Files live in one shared library, so any Session can refer to a file uploaded for another.

## Decisions

1. **Path references.** The Session gets the file's path and reads it with its Read tool. No change to the mod's submit API.
2. **Types: images and PDFs only.** Nothing else for now.
3. **Sessions only.** Uploads and `@` references do not work in General.
4. **Storage: one shared library, kept until deleted.** Files are not tied to a chat or a Session, and nothing expires automatically. Files are removed only by a delete action in the library picker.

## Current path (what exists today)

1. The browser sends `POST /api/chats/:id/messages` with `{ clientId, text }` (`src/channel/web/api.ts`, `sendMessage`).
2. The Bridge stores it as an Instruction: `deps.store.enqueueInstruction(session.id, body.text)`.
3. The Claude mod polls queued Instructions and submits each one as a user turn: `pollInstructions` in `mod/remote-agent/hooks/flows.ts`. `Instruction` carries `text` only.
4. The web feed shows the message as a `user_text` body (`src/channel/web/protocol.ts`).

## Storage

- **Files:** `<stateDir>/uploads/<uploadId>/<safe-name>`, where `<stateDir>` is the Bridge state directory (`~/.local/state/remote-agent` by default). The Bridge creates the path; the client never chooses it.
- **Metadata:** a new `uploads` table in the Bridge SQLite database: `id`, `name`, `mime`, `size`, `sha256`, `created_at`.
- **Dedup:** the same bytes uploaded twice return the existing entry (matched by `sha256`), so the library does not fill with copies.
- **Name:** the original name, sanitized to a basename with a safe character set and a length cap. It is used only for display and as the file name on disk.

**Limits:** 10 MB per file; 5 references per message. Allowed: PNG, JPEG, GIF, WebP, PDF. Type comes from magic bytes, not the client's `Content-Type`. SVG is refused.

## API (all behind the existing auth)

- `GET /api/uploads`: the library, newest first, with name, mime, size and created time.
- `POST /api/uploads`: raw file body, `X-File-Name` header. Returns `{ upload }`. Refused for a non-image, non-PDF file, an oversized one, or bad magic bytes.
- `GET /api/uploads/:id`: serves the file with its sniffed `Content-Type`, `Cache-Control: private`, and `X-Content-Type-Options: nosniff`. Authenticated; no per-chat check, since the library is shared.
- Thumbnails: `GET /api/uploads/:id?thumb=1` returns a small (max 256 px) WebP or JPEG rendition of an image, generated when the file is stored. PDFs have no thumbnail; the picker shows an icon.
- `DELETE /api/uploads/:id`: removes the file and its row. Messages that already reference it keep the name and show the file as removed.
- `POST /api/chats/:id/messages` gains `attachmentIds: string[]` (max 5, default empty). Each id must exist, otherwise `400`. General chat refuses attachments with `409`.

## Sending and what the Session receives

The instruction text is the typed text plus a block with the absolute paths:

```
<typed text>

Attached files (read them with the Read tool):
- /home/u/.local/state/remote-agent/uploads/<id>/<name>.png
```

## Composer: `@` picks from the library

- Typing `@` in the composer opens a picker above the text box. It lists library files, filtered by what comes after the `@`.
- Each row shows a thumbnail for an image, generated from the stored file and loaded through the authenticated GET. A PDF shows a PDF icon instead, with no thumbnail. Each row also shows the name and size.
- Choosing a file inserts a chip with its name and adds its id to the message's `attachmentIds`. Several can be added to one message, up to 5.
- The picker also has **Upload new…**, which opens the system file chooser (images and PDFs only). The upload goes to the library, and the new file is selected right away.
- Delete is available in the picker for each library file, with a confirmation.
- Keyboard: arrow keys move through the list, Enter picks, Escape closes. On phones the picker is a bottom sheet.

The message feed shows chosen files as chips on the message. Images show a thumbnail, loaded through the authenticated GET. A deleted file shows as removed.

## Permissions

Claude Code may ask before reading a path outside its working directory. The library is outside every repo, so:

- Spawned Sessions start with `--add-dir <uploadsDir>` through the agent adapter (`claudeCodeAdapter`), so reads from the library are allowed from the start.
- Sessions the Bridge did not start cannot get that flag. Reads there may still prompt. This is a known limit.

## Phases

**Phase 1:** library storage, the API above, the `@` picker with upload and delete, and the message chips and thumbnails. Sessions only.

**Phase 2:** paste an image from the clipboard into the composer, and drag and drop onto the chat. Both add to the library the same way as Upload new.

Retention is manual by design, so there is no sweep phase.

## Tests

- Thumbnail: an image upload gets a thumbnail; a PDF does not; `?thumb=1` on a PDF is refused.
- Upload refuses an oversized file, a disallowed type, an SVG, bytes that don't match the type, and a traversing or empty name.
- Upload with identical bytes returns the existing entry.
- Upload, GET and DELETE require auth. GET serves the stored type with `nosniff`.
- Send with an unknown `attachmentIds` entry is `400`; send with attachments in General is `409`.
- The instruction text contains the absolute paths and the typed text unchanged.
- Delete removes the file and the row, and old messages still render with a "removed" marker.
- Composer: `@` opens the picker and filters it; picking adds a chip; Escape closes; Upload new selects the new file; delete asks first.

## Security notes

- Names are sanitized; storage paths are generated by the Bridge.
- Content type comes from magic bytes, and `nosniff` is set when serving.
- Uploads are served only to authenticated users. The library is visible to everyone who can use the web channel, which is the single allowed login.
- Uploaded files may contain secrets, and a Session can read any file in the library. The picker should make that clear.

## Open questions

None. Ready to start phase 1 when you say so.
