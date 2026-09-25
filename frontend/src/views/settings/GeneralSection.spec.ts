import { makeSessionState, makeUser } from '@/test/fixtures'
import { flushPromises } from '@/test/mount'
import { mountSection } from '@/test/settings'
import { formatShortDate } from '@/utils/format'
import GeneralSection from '@/views/settings/GeneralSection.vue'

describe('GeneralSection', () => {
  it('edits the household name and validates it', async () => {
    const { wrapper, preferences } = await mountSection(GeneralSection)
    const input = wrapper.find('[data-test="household-name"] input')
    await input.setValue('The Coves')
    expect(preferences.draft!.general.household_name).toBe('The Coves')

    await input.setValue('   ')
    await flushPromises()
    expect(wrapper.text()).toContain('Give your household a name')

    await input.setValue('x'.repeat(81))
    await flushPromises()
    expect(wrapper.text()).toContain('Keep it under 80 characters')
    wrapper.unmount()
  })

  it('previews amounts and dates in the chosen format', async () => {
    const { wrapper, preferences } = await mountSection(GeneralSection)
    const preview = () => wrapper.find('[data-test="format-preview"]').text()
    expect(preview()).toContain('$1,234.56')
    expect(preview()).toContain(formatShortDate(new Date()))

    preferences.draft!.general.currency = 'EUR'
    preferences.draft!.general.locale = 'de-DE'
    await flushPromises()
    expect(preview()).toContain('1.234,56 €')
    expect(preview()).toContain(formatShortDate(new Date(), 'de-DE'))
    wrapper.unmount()
  })

  it('offers currencies, formats and months with readable names', async () => {
    const { wrapper } = await mountSection(GeneralSection)
    expect(wrapper.find('[data-test="currency"]').text()).toContain('USD · US Dollar')
    expect(wrapper.find('[data-test="locale"]').text()).toContain('American English')
    expect(wrapper.find('[data-test="fiscal-month"]').text()).toContain('January')
    wrapper.unmount()
  })

  it('switches the first day of the week', async () => {
    const { wrapper, preferences } = await mountSection(GeneralSection)
    await wrapper.find('[data-test="week-start"]').findAll('button')[1]!.trigger('click')
    expect(preferences.draft!.general.week_starts_on).toBe('monday')
    wrapper.unmount()
  })

  it('writes currency, format and budget year back to the draft', async () => {
    const { wrapper, preferences } = await mountSection(GeneralSection)
    await wrapper.findComponent({ name: 'VAutocomplete' }).setValue('GBP')
    const [locale, month] = wrapper.findAllComponents({ name: 'VSelect' })
    await locale!.setValue('en-GB')
    await month!.setValue(4)
    expect(preferences.draft!.general).toMatchObject({
      currency: 'GBP',
      locale: 'en-GB',
      fiscal_year_start_month: 4,
    })
    wrapper.unmount()
  })

  it('is read-only for viewers', async () => {
    const { wrapper, preferences } = await mountSection(GeneralSection, {
      session: makeSessionState({ user: makeUser({ role: 'viewer' }) }),
    })
    expect(wrapper.find('[data-test="read-only-notice"]').exists()).toBe(true)
    expect(wrapper.find('[data-test="household-name"] input').attributes('readonly')).toBeDefined()
    const monday = wrapper.find('[data-test="week-start"]').findAll('button')[1]!
    expect(monday.attributes('disabled')).toBeDefined()
    await monday.trigger('click')
    expect(preferences.draft!.general.week_starts_on).toBe('sunday')
  })
})
