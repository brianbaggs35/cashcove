import * as client from '@/api/client'
import { fetchPreferences, savePreferences, type Preferences } from '@/api/preferences'
import { fetchSystemInfo } from '@/api/system'

describe('endpoint wrappers', () => {
  it('reads and saves preferences', async () => {
    const get = vi.spyOn(client, 'apiGet').mockResolvedValue({})
    const put = vi.spyOn(client, 'apiPut').mockResolvedValue({})
    await fetchPreferences()
    expect(get).toHaveBeenCalledWith('/settings')
    const preferences = {} as Preferences
    await savePreferences(preferences)
    expect(put).toHaveBeenCalledWith('/settings', preferences)
  })

  it('reads system info', async () => {
    const get = vi.spyOn(client, 'apiGet').mockResolvedValue({})
    await fetchSystemInfo()
    expect(get).toHaveBeenCalledWith('/system')
  })
})
