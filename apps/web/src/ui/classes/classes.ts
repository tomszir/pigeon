/** Joins CSS module classes, skipping the ones whose condition is off: classes(a, on && b). */
export function classes(...names: readonly (string | false | null | undefined)[]): string {
  return names.filter((name) => typeof name === 'string' && name !== '').join(' ')
}
