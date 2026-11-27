// Times and days as the era's chat windows wrote them, in the visitor's own time zone.

/** "6:38 PM", like the taskbar clock. */
export function clockTime(at: number): string {
  const date = new Date(at)
  const hours = date.getHours()
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${hours % 12 === 0 ? 12 : hours % 12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`
}

/** "November 24", the day without the year. */
export function dayName(at: number): string {
  return new Date(at).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
}

/** "November 24, 2026 at 6:38 PM": the whole date, for a time's tooltip. */
export function fullTime(at: number): string {
  return `${dayName(at)}, ${new Date(at).getFullYear()} at ${clockTime(at)}`
}

const dayStart = (at: number) => {
  const date = new Date(at)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** Whether two moments are on the same calendar day. */
export const sameDay = (a: number, b: number) => dayStart(a) === dayStart(b)

/** What a day line says: "Today", "Yesterday", or the day with its year when it isn't this one's. */
export function dayLabel(at: number, now: number): string {
  if (sameDay(at, now)) return 'Today'
  const yesterday = new Date(dayStart(now))
  yesterday.setDate(yesterday.getDate() - 1)
  if (sameDay(at, yesterday.getTime())) return 'Yesterday'
  return new Date(at).getFullYear() === new Date(now).getFullYear()
    ? dayName(at)
    : `${dayName(at)}, ${new Date(at).getFullYear()}`
}
