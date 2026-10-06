import type { StatementReading } from '@/api/ai'
import { useAiStore } from '@/stores/ai'
import type { StatementMessage } from '@/stores/aiChat'
import { makeAiSettings, makeProviders, makeStatementReading, makeStatementRow } from '@/test/ai'
import { seedFinance } from '@/test/finance'
import { makeImport } from '@/test/imports'
import { mountWithPlugins } from '@/test/mount'
import { formatDateRange } from '@/utils/dates'
import StatementCard from '@/views/ai/StatementCard.vue'

function makeMessage(changes: Partial<StatementMessage> = {}): StatementMessage {
  return {
    kind: 'statement',
    id: 2,
    role: 'assistant',
    file: new File(['%PDF-1.7'], 'september.pdf', { type: 'application/pdf' }),
    status: 'done',
    reading: makeStatementReading(),
    error: null,
    imported: null,
    ...changes,
  }
}

async function render(message: StatementMessage, opening = false) {
  const mounted = await mountWithPlugins(StatementCard, {
    props: { message, opening },
    beforeMount: () => {
      seedFinance()
      const ai = useAiStore()
      ai.providers = makeProviders()
      ai.settings = makeAiSettings()
    },
  })
  const find = (name: string) => mounted.wrapper.find(`[data-test="${name}"]`)
  return { ...mounted, find }
}

const reading = (changes: Partial<StatementReading>) => makeStatementReading(changes)

describe('StatementCard', () => {
  describe('while the AI reads it', () => {
    it('says what is happening, and can be stopped', async () => {
      const { wrapper, find } = await render(makeMessage({ status: 'reading', reading: null }))

      expect(find('statement-progress').text()).toContain('Reading september.pdf')
      expect(find('statement-progress').text()).toContain(
        'Only its transaction lines go to GPT-6 Luna',
      )
      expect(find('statement-review').exists()).toBe(false)

      await find('statement-cancel').trigger('click')

      expect(wrapper.emitted('cancel')).toHaveLength(1)
    })
  })

  describe('once it has been read', () => {
    it('says what was found, which account it looks like, and what came in and went out', async () => {
      const { find } = await render(makeMessage())

      expect(find('statement-found').text()).toBe('Found 3 transactions in september.pdf')
      // The days the rows span, as the review says them, then the account.
      const days = formatDateRange({ start: '2026-09-02', end: '2026-12-30' })
      expect(find('statement-details').text()).toBe(`${days} · Looks like Everyday checking`)
      expect(find('statement-figures').text()).toContain('Money in $2,400.00')
      expect(find('statement-figures').text()).toContain('Money out -$134.12')
      expect(find('statement-flagged').text()).toBe('1 needs a look')
    })

    it('opens the review, and says it does while it gets ready', async () => {
      const { wrapper, find } = await render(makeMessage())

      await find('statement-review').trigger('click')
      expect(wrapper.emitted('review')).toHaveLength(1)
      expect(find('statement-review').classes()).not.toContain('v-btn--loading')

      await wrapper.setProps({ opening: true })
      expect(find('statement-review').classes()).toContain('v-btn--loading')
      expect(wrapper.text()).toContain('Nothing is added until you’ve checked it.')
    })

    it('says to choose the account when none looks right, and counts every row that needs a look', async () => {
      const { find } = await render(
        makeMessage({
          reading: reading({
            account_id: null,
            rows: [
              makeStatementRow({ date: null }),
              makeStatementRow({ line: 2, amount: null }),
              makeStatementRow({ line: 3, note: 'Check the date.' }),
            ],
          }),
        }),
      )

      expect(find('statement-details').text()).toBe(
        'Sep 2, 2026 · You choose the account in the next step',
      )
      expect(find('statement-flagged').text()).toBe('3 need a look')
    })

    it('says so for one transaction, and has nothing to look at when nothing needs it', async () => {
      const { find } = await render(
        makeMessage({ reading: reading({ rows: [makeStatementRow()], account_id: null }) }),
      )

      expect(find('statement-found').text()).toBe('Found 1 transaction in september.pdf')
      expect(find('statement-flagged').exists()).toBe(false)
    })

    it('has no dates to give for rows that have none', async () => {
      const { find } = await render(
        makeMessage({
          reading: reading({
            rows: [makeStatementRow({ date: null })],
            account_id: 'account-checking',
          }),
        }),
      )

      expect(find('statement-details').text()).toBe('Looks like Everyday checking')
    })

    it('says what importing it added, and links to it', async () => {
      const { find } = await render(
        makeMessage({
          imported: makeImport({ id: 'import-9', added: 2, account_id: 'account-checking' }),
        }),
      )

      expect(find('statement-imported').text()).toContain(
        'Imported 2 transactions into Everyday checking.',
      )
      expect(find('statement-see').attributes('href')).toBe('/transactions?import=import-9')
      expect(find('statement-review').exists()).toBe(false)
    })

    it('names no account for an import into one that has gone', async () => {
      const { find } = await render(makeMessage({ imported: makeImport({ account_id: 'gone' }) }))

      expect(find('statement-imported').text()).toContain('into the account.')
    })
  })

  describe('when it was not read', () => {
    it('says why, and tries again when asked', async () => {
      const { wrapper, find } = await render(
        makeMessage({ status: 'failed', reading: null, error: 'There’s no text in this PDF.' }),
      )

      expect(find('statement-error').text()).toBe('There’s no text in this PDF.')

      await find('statement-reread').trigger('click')

      expect(wrapper.emitted('reread')).toHaveLength(1)
    })

    it('says it was stopped, and reads it again when asked', async () => {
      const { wrapper, find } = await render(makeMessage({ status: 'cancelled', reading: null }))

      expect(find('statement-stopped').text()).toBe('Stopped reading september.pdf.')

      await find('statement-reread').trigger('click')

      expect(wrapper.emitted('reread')).toHaveLength(1)
    })
  })
})
