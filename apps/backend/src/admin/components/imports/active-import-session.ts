const ACTIVE_IMPORT_SNAPSHOT_KEY = "holo-trail-active-import-snapshot-id"

export const rememberActiveImportSnapshot = (snapshotId: string) => {
  if (typeof window !== "undefined" && snapshotId) {
    window.sessionStorage.setItem(ACTIVE_IMPORT_SNAPSHOT_KEY, snapshotId)
  }
}

export const getRememberedActiveImportSnapshot = () => {
  if (typeof window === "undefined") return ""
  return window.sessionStorage.getItem(ACTIVE_IMPORT_SNAPSHOT_KEY) ?? ""
}
