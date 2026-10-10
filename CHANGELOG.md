# Changelog

What changed in each release of Cashcove, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions are numbered as in
[Semantic Versioning](https://semver.org/). Add what you change under **Unreleased** as you go,
and give it a version and a date when you cut a release (see Releases in the
[README](README.md)).

## 0.2.6 - 2026-10-10

### Changed

- **Past-payment search.** When linking a subscription or bill, type to search older transactions
  by payee, notes or amount instead of scrolling through only the newest 200. Shared category
  pickers continue to filter by category name or group.
- **Prevent duplicate transaction imports.** When importing transactions via bank statement PDF
  or a file (CSV, etc.) the system will check for any duplicates and flag them for review.

### Dependency Updates

- Updated fastapi to 1.143.0
- Updated pydantic to 2.14.0
- Updated pypdf to 6.20.0

## 0.2.5 - 2026-10-08

### Upgrading

- Migration `0017` adds persistent AI proposals, including their pending, approved or rejected
  status and any context given when they were rejected.
- Migration `0018` adds per-admin AI chat history, which can be viewed and deleted from the AI tab.

### Added

- **Actions in AI chat.** One provider-independent JSON tool protocol works with local and cloud
  Ollama, Anthropic and OpenAI. The AI can look up transactions, budgets and recurring payments,
  then propose changes such as categorizing transactions, creating automations, changing budgets,
  and setting up bills or subscriptions. Nothing changes until an admin approves the proposal.
  Each proposal is kept with an ID and an expiry time, and the chat shows its status and results
  after approval or rejection. Rejection can include context for the AI's next reply.
- **Private references for AI actions.** Accounts, banks and people are represented by random
  request-scoped codes when the AI needs to refer to them. Account numbers and other personal
  information are removed rather than tokenized, and the server checks every provider request
  before sending it.
- **Admin-only AI access.** The AI page, chat, settings and proposal decisions are restricted to
  admins; read-only settings and transaction search remain available to other signed-in users
  where the rest of the app needs them.
- **AI chat history.** Text questions and answers are saved on the Cashcove server, so a new chat
  no longer loses the previous one. Open **History** to revisit or permanently delete a
  conversation. PDF statements and their extracted rows are not saved in chat history.
- **Email and Discord alerts.** Send large-transaction, low-balance, budget, upcoming payment and
  bank-sync alerts through an SMTP server, a Discord webhook, or both. Settings test each channel;
  SMTP passwords and usernames, and Discord webhook URLs, are encrypted in the database.

### Changed

- **Import duplicate review.** File and AI statement imports flag transactions matching an
  existing date, payee and amount as possible duplicates. They start unticked, so they are
  excluded by default and can be included if they are separate transactions.

## 0.2.4 - 2026-10-06

### Upgrading

- Migration `0014` adds the AI tables: the household's provider settings, each review the AI made
  with the suggestions it found, and a count of the tokens each answer used. Like the migrations
  before it, it can be run again on a database that already has some or all of it, and changes
  nothing. AI is off until an admin sets it up in **Settings > AI**, so nothing changes for you
  until then.
- Migration `0015` lets an import be of a PDF statement and a usage row be for reading one, by
  adding `pdf` and `statement` to the two lists of values the database allows. It can be run again
  too, and nothing is changed for what is already there.
- Migration `0016` lets the AI's usage be for finding transactions and for suggesting automations,
  by adding `search` and `automation` to the list of purposes the database allows. It can be run
  again as well.
- If you run Cashcove from your own compose file and want Ollama on the same computer for AI, add
  `extra_hosts: ["host.docker.internal:host-gateway"]` to the service, as `docker-compose.yml` now
  does, and use `http://host.docker.internal:11434` as Ollama's address. `/api/ai/` also waits up to
  330 seconds on a slow model, where the rest of the API keeps its 60.

### Added

- **AI, optional.** Everything works the same without it, and each AI page says what to do first
  until it is set up.
  - **Settings > AI** chooses where it runs: Ollama on your computer (an address, with a button that
    fetches its models), Ollama Cloud (a key, with its models fetched and priced), Anthropic
    (Claude Haiku 4.5, the default, and Claude Sonnet 5.5) or OpenAI (GPT-6 Luna, the default,
    GPT-5.6 Luna, GPT-5.4 mini and the other small GPT-5 models). Every provider has a **Test
    connection** button that tries what is in the form before it is saved. A key is encrypted,
    kept on the server and never shown again.
  - **The AI tab** has three pages. **Ask** is a chat about your finances, answered from a summary of
    your records. **Recommendations** has the AI look over transactions nobody chose a category for
    and suggest one for each, which an admin applies or dismisses, one at a time or several; nothing
    changes until one is applied, and a category chosen by hand is never reviewed. **Usage** shows
    tokens and an estimated cost by day, model and purpose, at each provider's published list price.
  - **Importing a file** can end with an **AI second opinion**: the automations sort the rows as
    they come in, then the AI looks over how they were sorted. Turn it off in Settings > AI.
  - The Dashboard says when suggestions are waiting.
  - **Reading a PDF statement.** An admin can give the AI a bank's PDF on the AI tab (the paperclip,
    **Choose a PDF**, or dropping it on the conversation) or on the Import tab, and it takes the
    transactions off it. The chat shows a card that says it is reading, for how long and what
    stays on this computer, with a button to stop; then what it found, how much came in and went
    out, which account it looks like and how many rows need a look. **Review and import** opens the
    import's own review, where a pencil on each row corrects its date, payee, amount or which way
    the money went, **Flip money in and out** mends a statement read the wrong way round, and
    nothing is added until you tick it, so duplicates, automations, balances and undo work as for
    a CSV file. Without AI, a PDF says it can only be read with AI, and the AI tab says so too.
  - **Find transactions in your own words.** Once AI is set up, **Find with AI** beside the
    Transactions tab's filters opens a box: "groceries over $50 last month". The AI turns it into
    the tab's own filters (words, categories, dates, amounts, which way the money went, where it
    came from, the order), which are checked here, replace the ones that were on and show as the
    chips the tab has, to take off or change, and what it couldn't use is said. Anyone who can see
    transactions can use it. The accounts and banks a question names are found here, so no account
    or bank name is sent to find them.
  - **Suggest automations.** On the Automations tab an admin can have the AI look at the payees
    they put in the same category by hand again and again, which no automation sorts. It words
    each as a rule, which is tried on the transactions before it's offered, and each suggestion
    says how many times it was chosen, what it would sort now, what it would leave alone and
    which older automation overlaps it. **Review and create** opens the form for a new automation
    with it in, and nothing is created until it's saved.
  - **The PDF never leaves the server, and neither does anything that names you.** Cashcove takes
    the text out of the PDF itself and sends the AI only the transaction lines: no header, bank,
    holder, address, account number, summary or balance, and each line has account and card
    numbers, phone and ID numbers, addresses, the names of everyone in your household and the name
    after `Zelle to`, `Venmo`, `PayPal`, `Cash App` or a wire taken out. The account is matched
    here, from the last digits and the bank's name, and the direction of each amount is read from
    the statement's columns. A scan or a photo is refused, since sending a picture would send it
    all. What the AI says is checked against the line it was given, and anything doubtful is
    flagged for you. A long statement is read a batch at a time within five minutes, and a model
    too slow for it says so instead of the request timing out.
  - **No account number, account name or bank name ever reaches an AI.** What an AI is sent is built
    from dates, amounts, payees and the names of categories, budgets, subscriptions and bills;
    anything that looks like an account number, its last digits, an email address or a key is taken
    out of free text, along with the name of every account and bank you have set up; and a last
    check refuses to send a request that still has any. The tests keep every request a stand-in for
    the providers receives and fail if one holds an account number, account name or bank name. See
    [AI](README.md#ai-optional).
  - `GET /api/ai/providers`, `/settings`, `/usage`, `/reviews` and `/recommendations`, `PUT` and
    `DELETE /api/ai/settings`, and `POST /api/ai/models`, `/test`, `/chat`, `/reviews`,
    `/recommendations/apply` and `/recommendations/dismiss`. Reads are open to every signed-in
    person; changing anything needs an admin. `POST /api/ai/statements` reads a PDF and is an
    admin's, like importing. `POST /api/ai/search` turns what someone typed into filters and
    anyone who is signed in can ask, since it only picks filters, and
    `POST /api/ai/automation-suggestions` is an admin's, since it leads to making an automation.

### Changed

- The Import tab takes a PDF, which it said it couldn't read, and its file picker offers `.pdf`.
  `pypdf` is a new dependency, which reads the PDF's text on the server.
- The end-to-end job's time limit in CI goes from 30 to 60 minutes: the specs run one at a time, on
  a computer and a phone, and a slow runner took twice as long as a fast one and was cancelled.
- Frontend tests read time from the monotonic clock. Vue ignores an event dated no later than the
  moment its handler was attached, so a wall clock that steps back (WSL2's does, every half
  minute) could drop a click and fail a test at random.

## 0.2.3 - 2026-10-06

### Upgrading

- Migration `0013` adds `automations.direction` (every existing automation keeps sorting money
  both ways) and `transactions.category_chosen` (every existing transaction starts as not
  chosen, so what is there stays open to automations, as before). Like the migrations before
  it, it can be run again on a database that already has some or all of it, and changes nothing.

- Updated @lucide/vue to 1.52.0
- Updated vuetify to 4.2.4
- Updated @types/node to 26.6.4
- Updated @vitest/coverage-v8 to 5.0.3
- Updated vitest to 5.0.3
- Updated eslint to 10.12.0
- Updated eslint-plugin-playwright to 2.12.1
- Updated jsdom to 30.1.2
- Updated monocart-coverage-reports to 2.13.1
- Updated sass-embedded to 1.105.1
- Updated typescript-eslint to 8.71.1
- Updated vite to 8.3.3
- Updated vue-tsc to 3.3.12
- Updated fastapi to 0.142.2
- Updated sqlalchemy to 2.1.3
- Updated mypy to 2.4.0
- Updated ruff to 0.16.10
- Updated coverage to 7.16.2

### Added

- **Dashboard**, the first tab and where signing in lands: net worth with the accounts that
  make it up, how this month is going against the same days of last month and as a running
  total, income and spending for each of the last six months, where this month's spending went
  by category, budgets, what is coming up or overdue, the payees most was spent with and the
  latest transactions, with what needs attention at the top. The charts are Vuetify's sparkline
  and pie, in the data-viz palette, light and dark, and each can be read as a table (which fits
  a phone). It is also in the phone's bottom bar, in place of Subscriptions (still under More).
  - `GET /api/dashboard?today=…` works it all out from the transactions, across every account,
    leaving out money moving between the household's own accounts and converting other
    currencies like the budgets do.
- **Which way the money went, for automations**: an automation can be for money in, money out
  or either way, so a paycheck automation doesn't also sort a purchase from a shop of nearly the
  same name or count it as income. Ticking transactions to start an automation chooses it from
  them, the automation's card shows it, and income counted from the Budget tab is money in.
- **Importing a file shows what automations will do**: each row says it will be sorted, by
  which category and which subscription or bill, before anything is imported, the review says
  how many, and the finished import says how many were sorted.

### Changed

- Signing in lands on the Dashboard instead of Accounts, and so does the not-found page's way
  back.
- **A category someone chose is never changed by an automation.** Before, editing, pausing or
  resuming an automation could put back its own category on a transaction whose category had
  been chosen by hand. A category chosen in the transaction's form, its details or for several
  transactions is kept; taking it away hands the transaction back to automations.
- A transaction the bank changes after sending it is sorted again, so an automation that looks
  at its amount or name picks it up.

## 0.2.2 - 2026-10-05

### Upgrading

- **Budgets were rebuilt, and the old ones aren't carried over.** A budget used to be a plan
  for each category; it's now one amount for a week, two weeks, a month or a year, with what
  counts toward it linked to it. Migration `0011` drops the old budget tables and everything in
  them, so make the budgets you want again on the Budget tab after upgrading. Transactions,
  categories and subscriptions are untouched.
- `GET /api/subscriptions` lists only subscriptions now. Bills have their own `GET /api/bills`.
  Every subscription you already have stays a subscription.
- Migrations `0010` to `0012` run by themselves when the container starts. `0012` adds a
  checked, indexed `kind` column to `subscriptions` (every existing row becomes a
  subscription) and an index on `budget_links.subscription_id`. It can be run again on a
  database that already has some or all of it, and changes nothing.

### Added

- **Bills**, a tab just under Subscriptions, for what you owe a provider on a schedule, like
  electricity or a phone line, which is often a different amount each month.
  - Add a bill from the payment that paid it. Cashcove links every other payment like it that
    is already there, and each one that comes later, whether Plaid syncs it, a statement file
    (CSV, OFX or QIF) brings it or you add it by hand. The payment's category fills in the
    bill's category.
  - **Link payments** adds payments from any account by hand, or takes them off again.
    Linked payments take the bill's category, and the latest one moves its due date on.
  - A bill that changes every month expects the average of its recent payments, and says
    when the latest payment wasn't what it expected (**Update amount**).
  - Bills have a reminder of their own in **Settings > Alerts**, five days ahead until you
    change it. A bill (or subscription) past its due date with no payment linked is called out
    at the top of its page.
  - A bill can be linked to by an automation, counted toward a budget as spending, and chosen
    on a transaction's details or from the Transactions tab (**Link to subscription or
    bill**). The Transactions filter and the budget's sources and upcoming payments name it as
    a bill.
  - `GET`, `POST`, `PATCH` and `DELETE` on `/api/bills`, plus `/api/bills/{id}/payments`,
    mirror `/api/subscriptions`. Bills are stored with subscriptions, told apart by a new
    `kind` column, so they are matched, linked and sorted by exactly the same code. The kind
    comes from the route and can't be set or changed in a request.
- **Automations**, a tab that sorts transactions for you. Tick transactions or type text to
  look for, and say what happens to every one like them: a category, a subscription or bill
  their payments are linked to, and/or counting toward budgets. They look in the payee and in
  what the bank called it, so one automation covers Plaid and statement files, can be limited to
  an account or a range of amounts, and cover past and future transactions or only future ones.
  A preview says what one would sort, and which others already do the same, before it's saved.
- **Categories**, a tab of its own with create, edit, delete and move (Settings > Categories
  redirects to it).
- **Budget**, rebuilt around cards that switch between budgets, with period navigation, a
  summary, spending against an even pace, income and spending by period, where the money
  went, the bills still to come, what counts toward the budget and why, and the transactions
  that count, which an admin can take off and put back. The charts have table views.
- Subscriptions can have payments linked by hand from the Transactions tab or from the
  subscription, can expect a different amount each time, and offer **Update amount**.

### Changed

- **Deleting a category leaves what used it uncategorized by default.** Choosing somewhere to
  move its transactions is optional, and when you do, the subscriptions, bills and automations
  that used the category move there too, so what arrives later is filed with what's already
  there. Before, only its transactions moved.
- Subscription and bill cards always show a category, as **Uncategorized** when they have
  none, the way transactions do.
- The Transactions filter for a subscription's or bill's payments is named after it, like
  "City Power payments".
- Pages that list subscriptions or bills share one implementation, so both behave the same.

### Fixed

- Charts and the budget summary are readable from the keyboard and by screen readers without
  the focusable regions SonarQube flagged, and a chart's table no longer scrolls inside the
  page.
- Looking back over budget periods loops a fixed number of times whatever is asked for.

### Security

- Bills follow the same rules as subscriptions: everyone signed in can see them, only admins
  can change them, requests must come from Cashcove's own pages, and bodies with fields the API
  doesn't know are refused.

## 0.2.1 - 2026-10-04

### Added

- **Subscriptions**, a tab that keeps track of recurring payments, with the amount, how often,
  the account that pays them and when the next payment is due, reminders beforehand, and
  payments matched by payee.
- Budgets in the API: monthly and yearly, with rollover.
- Exchange rates, so accounts in other currencies count in the household's currency.
- **Import**, a tab to bring in statement files from any bank, with saved column layouts, a
  review step and undo, and a linked account's history from before it was connected.
- Why a bank that was just connected brought in nothing, and when Plaid can't get a bank's
  transactions, reading its history from the start once it can.

### Fixed

- Playwright specs for subscriptions and accessibility, a CI sign-in variable and issues flagged
  by SonarQube.

## 0.2.0 - 2026-09-28

### Added

- **Connect**, a tab to connect a bank through Plaid Link and choose its accounts, with
  transactions synced on a schedule in the API.
- Playwright fixtures for Plaid, Connect specs and the README's Plaid setup.

### Changed

- The backend's tests run on Postgres only, like the app.

### Fixed

- The bank cards on phones, and the blank logo the stand-in banks showed.

## 0.1.0 - 2026-09-27

### Added

- The first release: a FastAPI backend with PostgreSQL and Alembic, a Vue and Vuetify web app
  with light and dark themes, sign-in with passkeys and two-step codes, households with admins
  and viewers, settings, accounts and transactions.
