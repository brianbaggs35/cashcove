import { createPinia, setActivePinia } from 'pinia'

import { ApiError } from '@/api/client'
import * as api from '@/api/imports'
import { useImportsStore } from '@/stores/imports'
import {
  checkingImport,
  harborFormat,
  makeFormat,
  makeImport,
  mapleFormat,
  savingsImport,
} from '@/test/imports'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('imports store', () => {
  it('loads the imports and saved formats, once however many ask', async () => {
    const imports = vi.spyOn(api, 'fetchImports').mockResolvedValue([savingsImport, checkingImport])
    const formats = vi.spyOn(api, 'fetchSavedFormats').mockResolvedValue([harborFormat])
    const store = useImportsStore()

    await Promise.all([store.load(), store.ensureLoaded()])
    await store.ensureLoaded()

    expect(imports).toHaveBeenCalledOnce()
    expect(formats).toHaveBeenCalledOnce()
    expect(store.loaded).toBe(true)
    expect(store.loading).toBe(false)
    expect(store.imports).toEqual([savingsImport, checkingImport])
    expect(store.findImport(checkingImport.id)).toEqual(checkingImport)
    expect(store.findImport(null)).toBeUndefined()
    expect(store.findFormat(harborFormat.id)).toEqual(harborFormat)
    expect(store.findFormat(undefined)).toBeUndefined()
  })

  it('says why they could not be loaded', async () => {
    vi.spyOn(api, 'fetchImports').mockRejectedValue(new ApiError(0, 'Offline.'))
    vi.spyOn(api, 'fetchSavedFormats').mockResolvedValue([])
    const store = useImportsStore()
    await store.load()
    expect(store.loaded).toBe(false)
    expect(store.error).toBe('Offline.')
  })

  it('puts a new import first and forgets one that was undone', () => {
    const store = useImportsStore()
    store.imports = [savingsImport, checkingImport]
    const newer = makeImport({ id: 'import-new', file_name: 'september.csv' })

    store.added(newer)
    store.added({ ...newer, added: 3 })
    expect(store.imports.map((item) => item.id)).toEqual([
      'import-new',
      savingsImport.id,
      checkingImport.id,
    ])
    expect(store.imports[0]!.added).toBe(3)

    store.undone(savingsImport.id)
    expect(store.imports.map((item) => item.id)).toEqual(['import-new', checkingImport.id])
  })

  it('keeps saved formats by name, and imports without one that was deleted', () => {
    const store = useImportsStore()
    store.imports = [checkingImport, savingsImport]
    store.formats = [harborFormat, mapleFormat]

    store.putFormat(makeFormat({ id: 'format-amex', name: 'amex card' }))
    store.putFormat({ ...harborFormat, name: 'Zeta checking' })
    expect(store.formats.map((item) => item.name)).toEqual([
      'amex card',
      'Maple store card',
      'Zeta checking',
    ])

    store.removeFormat(harborFormat.id)
    expect(store.formats.map((item) => item.id)).toEqual(['format-amex', mapleFormat.id])
    expect(store.imports.map((item) => item.profile_id)).toEqual([null, null])
    expect(store.findImport(checkingImport.id)?.file_name).toBe(checkingImport.file_name)
  })
})
