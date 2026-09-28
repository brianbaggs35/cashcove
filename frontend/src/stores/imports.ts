import { defineStore } from 'pinia'
import { ref } from 'vue'

import { errorMessage } from '@/api/client'
import { fetchImports, fetchSavedFormats, type FileImport, type SavedFormat } from '@/api/imports'

const byName = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })

/** The files imported lately, newest first, and the formats saved for banks' files. */
export const useImportsStore = defineStore('imports', () => {
  const imports = ref<FileImport[]>([])
  const formats = ref<SavedFormat[]>([])
  const loaded = ref(false)
  const loading = ref(false)
  const error = ref<string | null>(null)
  let pending: Promise<void> | null = null

  function load(): Promise<void> {
    pending ??= (async () => {
      loading.value = true
      error.value = null
      try {
        const [recent, saved] = await Promise.all([fetchImports(), fetchSavedFormats()])
        imports.value = recent
        formats.value = saved
        loaded.value = true
      } catch (loadError) {
        error.value = errorMessage(loadError)
      } finally {
        loading.value = false
        pending = null
      }
    })()
    return pending
  }

  function ensureLoaded(): Promise<void> {
    return loaded.value ? Promise.resolve() : load()
  }

  function findImport(id: string | null | undefined): FileImport | undefined {
    return imports.value.find((item) => item.id === id)
  }

  function findFormat(id: string | null | undefined): SavedFormat | undefined {
    return formats.value.find((item) => item.id === id)
  }

  /** A new import goes first, as the newest. */
  function added(record: FileImport) {
    imports.value = [record, ...imports.value.filter((item) => item.id !== record.id)]
  }

  function undone(id: string) {
    imports.value = imports.value.filter((item) => item.id !== id)
  }

  /** Adds a saved format, or replaces it with what the API sent back. */
  function putFormat(format: SavedFormat) {
    formats.value = [...formats.value.filter((item) => item.id !== format.id), format].sort(
      (a, b) => byName.compare(a.name, b.name),
    )
  }

  function removeFormat(id: string) {
    formats.value = formats.value.filter((item) => item.id !== id)
    // Imports read with it stay, without it.
    imports.value = imports.value.map((item) =>
      item.profile_id === id ? { ...item, profile_id: null } : item,
    )
  }

  return {
    imports,
    formats,
    loaded,
    loading,
    error,
    load,
    ensureLoaded,
    findImport,
    findFormat,
    added,
    undone,
    putFormat,
    removeFormat,
  }
})
