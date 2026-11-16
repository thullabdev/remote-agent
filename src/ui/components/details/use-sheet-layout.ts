import { useEffect, useState } from 'react'

/** True on the narrow layout, where the panel is a sheet over the chat rather than a column beside it. */
export function useSheetLayout(): boolean {
  const [sheet, setSheet] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)')
    setSheet(query.matches)
    const onChange = () => setSheet(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])
  return sheet
}
