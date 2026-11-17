type ListNotesProps = {
  /** Shown on the Ended tab, while there is something to archive and nothing is selected yet. */
  showArchiveHint: boolean
  /** The number of matches, when a search is running and has any. */
  resultCount: number | null
}

/** Short lines above the rows: how to archive, and how many results a search found. */
export function ListNotes({ showArchiveHint, resultCount }: ListNotesProps) {
  return (
    <>
      {showArchiveHint && <p className="px-2 pb-2 text-xs text-muted-foreground">Press and hold a session to select it, then archive.</p>}
      {resultCount !== null && <p className="px-2 pb-2 text-xs text-muted-foreground">{resultCount === 1 ? '1 result' : `${resultCount} results`}</p>}
    </>
  )
}
