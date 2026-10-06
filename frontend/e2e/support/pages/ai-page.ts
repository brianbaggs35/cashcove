import { expect, type Locator, type Page } from '@playwright/test'

import type { StatementFile } from '../statements'
import { exactly, startingWith } from './fields'

export type AiSection = 'ask' | 'recommendations' | 'usage'

/** Which suggestions the Recommendations page lists. */
export type SuggestionStatus = 'Waiting' | 'Applied' | 'Dismissed'

const PATHS: Record<AiSection, string> = {
  ask: '/ai',
  recommendations: '/ai/recommendations',
  usage: '/ai/usage',
}

/** What a review looks at, as the dialog words it. */
export interface ReviewChoice {
  /** The newest uncategorized transactions, or the recent ones. */
  scope?: 'Only uncategorized' | 'Recent ones'
}

/**
 * The AI tab: asking about the household's money, what the AI suggested about how its
 * transactions are sorted, and what it all cost.
 */
export class AiPage {
  readonly tabs: Locator
  /** How many suggestions are waiting, beside the Recommendations tab. */
  readonly waiting: Locator
  /** What the Ask page shows until AI is set up. */
  readonly setup: Locator
  readonly setupLink: Locator
  /** What it says to a viewer, who can't set AI up. */
  readonly setupViewer: Locator
  /** What the AI is and isn't told, where a question is asked. */
  readonly privacy: Locator

  /** Ask: the welcome, the questions to start from, the box, the conversation and its errors. */
  readonly welcome: Locator
  readonly questions: Locator
  readonly input: Locator
  readonly send: Locator
  readonly messages: Locator
  readonly busy: Locator
  readonly error: Locator
  readonly retry: Locator
  readonly clear: Locator

  /**
   * Statements: the offer in the welcome, the paperclip, what's said of a file that can't be
   * read here, a card for each statement in the conversation, and the drop target.
   */
  readonly statementOffer: Locator
  readonly statementChoose: Locator
  readonly statementViewer: Locator
  readonly attach: Locator
  readonly attachProblem: Locator
  readonly statementCards: Locator
  /** The conversation's card, which a file can be dropped on, and what shows while one is over it. */
  readonly conversation: Locator
  readonly dropTarget: Locator

  /** Recommendations: the review dialog, the progress and the suggestions listed. */
  readonly reviewButton: Locator
  readonly reviewDialog: Locator
  readonly activeReview: Locator
  readonly suggestions: Locator
  readonly history: Locator
  readonly decideError: Locator
  /** What to do with the suggestions that are ticked, or with the confident ones in one go. */
  readonly applySelected: Locator
  readonly dismissSelected: Locator
  readonly selectConfident: Locator

  /** Usage: the figures, the tables and how the cost is worked out. */
  readonly range: Locator
  readonly modelRows: Locator
  readonly pricing: Locator

  constructor(readonly page: Page) {
    this.tabs = page.getByTestId('ai-tabs')
    this.waiting = page.getByTestId('ai-tab-waiting')
    this.setup = page.getByTestId('ai-setup')
    this.setupLink = page.getByTestId('ai-setup-link')
    this.setupViewer = page.getByTestId('ai-setup-viewer')
    this.privacy = page.getByTestId('ai-privacy')

    this.welcome = page.getByTestId('chat-welcome')
    this.questions = page.getByTestId('chat-question')
    this.input = page.getByRole('textbox', { name: 'Ask a question' })
    this.send = page.getByTestId('chat-send')
    this.messages = page.getByTestId('chat-message')
    this.busy = page.getByTestId('chat-busy')
    this.error = page.getByTestId('chat-error')
    this.retry = page.getByTestId('chat-retry')
    this.clear = page.getByTestId('chat-clear')

    this.statementOffer = page.getByTestId('chat-statement-offer')
    this.statementChoose = page.getByTestId('chat-statement-choose')
    this.statementViewer = page.getByTestId('chat-statement-viewer')
    this.attach = page.getByTestId('chat-attach')
    this.attachProblem = page.getByTestId('chat-attach-problem')
    this.statementCards = page.getByTestId('statement-card')
    this.conversation = page.getByTestId('chat-card')
    this.dropTarget = page.getByTestId('chat-drop')

    this.reviewButton = page.getByTestId('review-open')
    this.reviewDialog = page.getByRole('dialog', { name: 'Review transactions' })
    this.activeReview = page.getByTestId('active-review')
    this.suggestions = page.getByTestId('recommendation')
    this.history = page.getByTestId('review-history-item')
    this.decideError = page.getByTestId('decide-error')
    this.applySelected = page.getByTestId('apply-selected')
    this.dismissSelected = page.getByTestId('dismiss-selected')
    this.selectConfident = page.getByTestId('select-confident')

    this.range = page.getByTestId('usage-range')
    this.modelRows = page.getByTestId('usage-table').first().getByTestId('usage-row')
    this.pricing = page.getByTestId('usage-pricing')
  }

  /** Opens one of the tab's pages, and waits until it has loaded. */
  async goto(section: AiSection = 'ask'): Promise<void> {
    await this.page.goto(PATHS[section])
    await expect(this.page.getByTestId('ai-loading')).toHaveCount(0)
    const loading = { recommendations: 'recommendations-loading', usage: 'usage-loading' }
    if (section !== 'ask') await expect(this.page.getByTestId(loading[section])).toHaveCount(0)
  }

  /** Opens another of the tab's pages from its tabs, as someone would. */
  async openPage(section: AiSection): Promise<void> {
    const titles: Record<AiSection, string> = {
      ask: 'Ask',
      recommendations: 'Recommendations',
      usage: 'Usage',
    }
    await this.page.getByTestId(`ai-tab-${section}`).filter({ hasText: titles[section] }).click()
    await expect(this.page).toHaveURL(new RegExp(`${PATHS[section]}$`))
  }

  /** Types a question, sends it and waits for the answer. */
  async ask(question: string): Promise<void> {
    const before = await this.messages.count()
    await this.input.fill(question)
    await this.send.click()
    await expect(this.messages).toHaveCount(before + 2)
    await expect(this.busy).toHaveCount(0)
  }

  /** The latest statement in the conversation: being read, found or failed. */
  get statement(): Locator {
    return this.statementCards.last()
  }

  /** What the latest statement's card says it found, e.g. `Found 4 transactions in x.pdf`. */
  get found(): Locator {
    return this.statement.getByTestId('statement-found')
  }

  /**
   * Gives the AI a PDF to read, as the paperclip does, and waits until it has finished: it
   * has found transactions, or says why it couldn't.
   */
  async attachStatement(file: StatementFile): Promise<void> {
    const before = await this.statementCards.count()
    await this.page.getByTestId('chat-file').setInputFiles(file)
    await expect(this.statementCards).toHaveCount(before + 1)
    await expect(this.statement).toHaveAttribute('data-status', /^(done|failed)$/)
  }

  /**
   * Drops a PDF on the conversation, as dragging one in from the desktop does, and waits
   * until it has been read. Dragging it over shows where to drop it.
   */
  async dropStatement(file: StatementFile): Promise<void> {
    const before = await this.statementCards.count()
    const transfer = await this.page.evaluateHandle(
      ({ name, mimeType, bytes }) => {
        const data = new DataTransfer()
        data.items.add(new File([new Uint8Array(bytes)], name, { type: mimeType }))
        return data
      },
      { name: file.name, mimeType: file.mimeType, bytes: Array.from(file.buffer) },
    )
    await this.conversation.dispatchEvent('dragenter', { dataTransfer: transfer })
    await expect(this.dropTarget).toBeVisible()
    await this.conversation.dispatchEvent('drop', { dataTransfer: transfer })
    await expect(this.dropTarget).toHaveCount(0)
    await expect(this.statementCards).toHaveCount(before + 1)
    await expect(this.statement).toHaveAttribute('data-status', /^(done|failed)$/)
  }

  /** Opens what the AI found for review, in the same dialog as the Import tab's. */
  async reviewStatement(): Promise<void> {
    await this.statement.getByTestId('statement-review').click()
    await expect(this.page.getByTestId('import-review')).toBeVisible()
  }

  /** The text of the latest message in the conversation. */
  async lastMessage(): Promise<string> {
    return (await this.messages.last().textContent()) ?? ''
  }

  /** A figure on the Recommendations page: `open`, `applied` or `dismissed`. */
  tile(name: 'open' | 'applied' | 'dismissed'): Locator {
    return this.page.getByTestId(`tile-${name}`)
  }

  /** A suggestion, by the payee of the transaction it's about. */
  suggestion(payee: string): Locator {
    return this.suggestions.filter({
      has: this.page.getByTestId('reco-payee').filter({ hasText: exactly(payee) }),
    })
  }

  /** Shows the suggestions that are waiting, or the ones applied or dismissed. */
  async show(status: SuggestionStatus): Promise<void> {
    await this.page
      .getByTestId('recommendation-status')
      .getByRole('button', { name: startingWith(status) })
      .click()
  }

  /** Asks for a review and waits until the AI has looked, however much it found. */
  async review({ scope }: ReviewChoice = {}): Promise<void> {
    const before = await this.history.count()
    await this.reviewButton.click()
    await expect(this.reviewDialog).toBeVisible()
    if (scope) await this.reviewDialog.getByRole('button', { name: exactly(scope) }).click()
    await this.reviewDialog.getByTestId('review-start').click()
    await expect(this.reviewDialog).toBeHidden()
    // It carries on after it has started, and ends up in the list of times the AI looked.
    await expect(this.history).toHaveCount(before + 1)
    await expect(this.history.first().getByTestId('review-summary')).toContainText(
      /^\s*(Looked at|Stopped)/,
    )
  }

  async apply(payee: string): Promise<void> {
    await this.suggestion(payee).getByTestId('reco-apply').click()
  }

  async dismiss(payee: string): Promise<void> {
    await this.suggestion(payee).getByTestId('reco-dismiss').click()
  }

  /** Ticks suggestions to decide on together. */
  async tick(payees: string[]): Promise<void> {
    for (const payee of payees) {
      await this.suggestion(payee)
        .getByTestId('recommendation-select')
        .getByRole('checkbox')
        .check()
    }
  }

  /** Shows the figures for another range, e.g. `'7 days'`. */
  async showRange(label: string): Promise<void> {
    await this.range.getByRole('button', { name: exactly(label) }).click()
  }

  /** A row of the by-model table, by the model's name. */
  modelRow(name: string): Locator {
    return this.modelRows.filter({ hasText: name })
  }

  /** A figure on the Usage page: `month`, `range`, `in` or `out`. */
  usageTile(name: 'month' | 'range' | 'in' | 'out'): Locator {
    return this.page.getByTestId(`usage-tile-${name}`)
  }
}
