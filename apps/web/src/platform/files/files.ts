// Files you save and open yourself: an export of your data (M13), a conversation saved as text.
// An interface, so the Messenger's windows take it from the composition root.

export interface Files {
  /** Hands the visitor a text file to save, named `name`. */
  saveText(name: string, text: string): void
  /** Asks the visitor for a text file; undefined if they cancel or it can't be read. */
  openText(accept: string): Promise<string | undefined>
}
