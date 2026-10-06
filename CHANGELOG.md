# Changelog

What changed in each release of Cashcove, newest first. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions are numbered as in
[Semantic Versioning](https://semver.org/). Add what you change under **Unreleased** as you go,
and give it a version and a date when you cut a release (see Releases in the
[README](README.md)).

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
