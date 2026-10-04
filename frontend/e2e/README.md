# End-to-end tests

Playwright drives the real app in Chromium, on a computer-sized screen (`desktop`) and a
phone (`mobile`, a Pixel 7), against a test server built from the production image. Every
spec starts from the same **baseline** data, so you always know what's in the database.
The Budget spec makes budgets, switches between them and counts income and spending toward
them in every way (transactions, accounts, categories, subscriptions and automations),
including what Plaid and statement files bring in, on both screen sizes.

## Running them

```sh
make install     # once: npm packages and Playwright's Chromium
make e2e         # builds and starts the test server, then runs every spec
make e2e ARGS="sign-in --project=desktop"   # just some specs, on one screen size
make e2e-ui      # Playwright's UI: pick tests, watch them, step through each action
make e2e-report  # the last run's HTML report, with traces of anything that failed
make e2e-down    # stop the test server
```

The test server keeps running between runs at `https://localhost:9443` (its certificate is
self-signed), and `make e2e` rebuilds it when the code changed. From `frontend/`,
`npm run e2e` runs the specs against a server that's already up. To point them somewhere
else, set `CASHCOVE_E2E_URL`; they refuse to run against anything but the e2e image.

## The test server

`make e2e-up` builds the Dockerfile's `e2e` target: the production image, plus

- the **test harness** (`backend/e2e/`), served at `/api/e2e/`, which resets the database
  and signs browsers in without the sign-in form,
- the API running under coverage.py, and the web app built with source maps, for coverage,
- nginx's per-address rate limits lifted, since tests sign in far faster than people do.

The harness can erase every account, so it only starts with `CASHCOVE_ENVIRONMENT=test`,
the production image never contains it, and the test server keeps its data in memory,
ignores `.env` and only listens on this computer.

Tests run one at a time, because they share the one database.

## The baseline

`baseline.reset()` replaces everything in the database with this:

| Who           | In `baseline`         | Role   | Notes                                            |
| ------------- | --------------------- | ------ | ------------------------------------------------ |
| Alex Rivera   | `users.admin`         | Admin  | Password, and a passkey on their iPhone          |
| Jordan Rivera | `users.two_step`      | Admin  | Authenticator app and ten recovery codes         |
| Sam Rivera    | `users.viewer`        | Viewer | Read-only everywhere                             |
| Casey Rivera  | `users.deactivated`   | Viewer | Turned off by Alex 10 days ago, so can't sign in |
| Riley Chen    | `invitations.pending` | Viewer | Invited by Alex two days ago, not yet joined     |

- The household is called **The Rivera household** (`baseline.household_name`).
- Everyone signs in with the password in `baseline.users.<key>.password`.
- Jordan's authenticator key is `baseline.users.two_step.totp_secret`; `totpCode(secret)`
  gives the current code. Each recovery code in `recovery_codes` works once per reset.
- Alex's passkey ("Alex's iPhone", in iCloud Keychain) is `baseline.users.admin.passkeys[0]`.
  `addPasskey(page, passkey)` puts it in the test's browser, so "Sign in with a passkey" works.
  Chromium would use it from the email field's autofill as soon as the sign-in page opens, so
  `addPasskey` turns that autofill off; pass `{ autofill: true }` to test it.
- Riley's invitation link is `baseline.invitations.pending.link`.

Everyone but Riley has signed in before, so Settings > Users shows when, and they're still
signed in on these browsers, which Settings > Security lists (`users.<key>.devices`):

| Who    | Browser           | Signed in    | Last active  |                            |
| ------ | ----------------- | ------------ | ------------ | -------------------------- |
| Alex   | Chrome on Windows | At the reset | Now          | The admin's saved sign-in  |
| Alex   | Safari on iPhone  | 9 days ago   | 2 hours ago  |                            |
| Alex   | Firefox on macOS  | 26 hours ago | 20 hours ago |                            |
| Sam    | Chrome on Windows | At the reset | Now          | The viewer's saved sign-in |
| Sam    | Chrome on Android | 5 days ago   | 20 hours ago |                            |
| Jordan | Safari on iPad    | 3 days ago   | 50 hours ago |                            |

`baseline.activity` is the household's story over four months, newest first, as the activity
logs show it: setting up Cashcove, invitations and people joining, Jordan turning on two-step
verification, Alex changing their password and adding the passkey, sign-ins with a password,
a passkey and an authenticator code, two failed sign-ins and Alex turning Casey's account off. That's 23 entries, all of
which Settings > Users shows; 9 are Alex's own, so Settings > Security shows 8 and a "Show
all" button.

The household keeps six accounts, all in US dollars:

| Account           | In `baseline`         | Kind        | Kept up to date by | Balance                       | Transactions |
| ----------------- | --------------------- | ----------- | ------------------ | ----------------------------- | ------------ |
| Everyday checking | `accounts.checking`   | Checking    | Hand               | $2,450.18                     | 111          |
| Rainy day fund    | `accounts.savings`    | Savings     | Hand               | $12,500.00                    | 27           |
| Rewards Visa      | `accounts.card`       | Credit card | Plaid (linked)     | $612.40 owed, $5,000.00 limit | 71           |
| Car loan          | `accounts.loan`       | Loan        | Hand               | $9,120.00 owed                | None         |
| Retirement 401(k) | `accounts.retirement` | Investment  | Plaid (linked)     | $48,210.55                    | None         |
| Old store card    | `accounts.closed`     | Credit card | Hand, now closed   | $0.00                         | 1            |

Two of them are kept up to date by banks connected through Plaid (`baseline.connections`),
which the Connect tab shows:

| Bank        | In `baseline`          | Imports           | Shares, not imported | State                                               |
| ----------- | ---------------------- | ----------------- | -------------------- | --------------------------------------------------- |
| Tartan Bank | `connections.tartan`   | Rewards Visa      | Tartan Checking      | Up to date, synced 3 hours ago; 4 syncs             |
| Fidelity    | `connections.fidelity` | Retirement 401(k) | Nothing              | Wants Alex to sign in again, so Connect has a badge |

Closed accounts don't count, so the net worth is **$53,428.33**: $63,160.73 of assets less
$9,732.40 owed. The categories are the 37 suggested ones every new household starts with,
in 11 groups, by name: `baseline.categories['Groceries']`,
`baseline.category_groups['Food & drink']`.

Eleven transactions have names in `baseline.transactions`: the ten newest, from the last two
weeks, and an old one on the closed card.

| Payee                  | In `baseline.transactions` | Account           | Amount    | Category             | Days ago |
| ---------------------- | -------------------------- | ----------------- | --------- | -------------------- | -------- |
| Blue Bottle Coffee     | `coffee`                   | Rewards Visa      | −4.50     | Coffee               | 0        |
| Venmo                  | `venmo`                    | Everyday checking | −40.00    | None                 | 1        |
| Whole Foods            | `groceries`                | Everyday checking | −84.12    | Groceries            | 3        |
| Target                 | `refund`                   | Rewards Visa      | +18.20    | Shopping             | 4        |
| Harbor Credit Union    | `interest`                 | Rainy day fund    | +10.42    | Interest & dividends | 5        |
| Netflix                | `netflix`                  | Rewards Visa      | −15.49    | Subscriptions        | 6        |
| Tartan Bank            | `card_payment`             | Everyday checking | −300.00   | Credit card payments | 7        |
| City Power & Light     | `power`                    | Everyday checking | −96.40    | Utilities            | 9        |
| Parkside Apartments    | `rent`                     | Everyday checking | −1,850.00 | Rent & mortgage      | 11       |
| Acme Corp              | `paycheck`                 | Everyday checking | +2,400.00 | Paycheck             | 13       |
| Maple Department Store | `store`                    | Old store card    | −35.00    | Clothing             | 45       |

- Together they're $2,428.62 in and $2,425.51 out.
- The Rewards Visa's transactions came from its bank, so they have what the bank called them
  (`original_description`) and can't have their date or amount changed. The coffee is still
  pending.
- Whole Foods has a note ("Weekly shop"), and Venmo is the only one without a category.
- Dates are relative to the reset: `dateOf(baseline.transactions.rent)` gives one's date.
  Transactions on the same day always sort in the same order.

Behind them, `baseline.history` holds a year of everyday money, 199 transactions from 15 to
398 days ago:

| Payees                                              | Account                            | How often                   |
| --------------------------------------------------- | ---------------------------------- | --------------------------- |
| Northwind Health, a +1,875.00 paycheck              | Everyday checking                  | Every two weeks             |
| Savings transfer, 250.00                            | Everyday checking → Rainy day fund | Monthly                     |
| Auto loan payment, Comcast Xfinity, State Farm      | Everyday checking                  | Monthly                     |
| Trader Joe's                                        | Everyday checking                  | Weekly, for three months    |
| ATM withdrawal                                      | Everyday checking                  | Monthly, for six months     |
| Zelle payment (no category), Monthly service fee    | Everyday checking                  | Now and then                |
| IRS, a +1,284.00 tax refund                         | Everyday checking                  | Once                        |
| Interest paid                                       | Rainy day fund                     | Monthly                     |
| Spotify, Verizon Wireless, Planet Fitness           | Rewards Visa                       | Monthly                     |
| Shell, Chipotle, Amazon, Costco                     | Rewards Visa                       | Regularly, for three months |
| CVS Pharmacy, Home Depot, Marriott, Delta Air Lines | Rewards Visa                       | Once each                   |

- That makes 210 transactions in all, $59,592.43 in and $18,655.66 out: more than the
  biggest page of 200, and some in every period the Transactions tab offers, last year
  included. `allTransactions(baseline)` lists them all, newest first.
- The Rewards Visa's came from its bank (`source: 'plaid'`). Of the accounts kept by hand,
  what's older than four months came from statement files imported when the household
  started with Cashcove (`source: 'file'`, with the bank's description, and `file_import`
  naming the import), and the rest was entered by hand.
- No payee in the history is also a named transaction's payee, so
  `transactionsPage.row('Netflix')` still finds exactly one row.

The Import tab lists those two imports, `baseline.imports`, which Alex made 120 days ago,
leaving the balances as they were:

| File                        | In `baseline.imports` | Account           | Read with                    | Transactions | Left out |
| --------------------------- | --------------------- | ----------------- | ---------------------------- | ------------ | -------- |
| harbor-savings-history.qfx  | `savings_history`     | Rainy day fund    | Its OFX tags                 | 19           | None     |
| harbor-checking-history.csv | `checking_history`    | Everyday checking | Harbor Credit Union checking | 62           | 2 rows   |

And the CSV layouts saved for banks' files, `baseline.saved_formats`. A CSV file with a
saved format's column names goes straight to reviewing its rows, into the account the
format was last used for:

| Saved format                 | In `baseline.saved_formats` | Columns                                                                     | Last used                     |
| ---------------------------- | --------------------------- | --------------------------------------------------------------------------- | ----------------------------- |
| Harbor Credit Union checking | `harbor_checking`           | Date, Description, Amount, Balance, Transaction ID                          | 120 days ago, for checking    |
| Maple store card             | `maple_card`                | Trans. Date, Post Date, Description, Amount, Category; charges are positive | Never; saved for the old card |

The household has three budgets, `baseline.budgets`, smallest period first. Their periods
start the usual way (weeks on Sunday, months on the 1st, years in January), so what they
hold depends on the day a test runs; specs that need exact numbers make a budget of their own
whose period starts 13 days ago, which holds every named transaction above and none of the
history.

| Budget         | In `baseline.budgets` | Amount           | Counts as income                                 | Counts as spending                                                                                                                    |
| -------------- | --------------------- | ---------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Spending money | `spending_money`      | 150.00 a week    | Nothing                                          | The Restaurants, Coffee, Shopping and Entertainment categories                                                                        |
| Household      | `household`           | 3,600.00 a month | The Paycheck and Interest & dividends categories | The Groceries, Utilities, Phone & internet, Insurance, Subscriptions and Gas & fuel categories; the Rewards Visa; the rent on its own |
| Year plan      | `year`                | 52,000.00 a year | The Paycheck and Interest & dividends categories | Everything out of Everyday checking                                                                                                   |

Each lists what counts toward it in `sources`: the kind, the type (`category`, `account` or
`transaction`) and the target by name or key.

Read values from `baseline` rather than copying them into specs, so the baseline can change
without breaking them. It's defined in `backend/e2e/baseline.py`.

## Writing a spec

Specs live in `e2e/specs/` and import everything from `../support`. `test.use` starts every
test in a file signed in as the admin or the viewer, and `baseline.reset()` in a
`beforeEach` puts the database back to the baseline before each test:

```ts
import { expect, expectAccessible, signInFiles, test } from '../support'

test.describe('Household settings', () => {
  test.use({ storageState: signInFiles.admin })

  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test('an admin renames the household', async ({ page, apiAs }) => {
    await page.goto('/settings/general')

    await page.getByTestId('household-name').locator('input').fill('The Rivera-Chen household')
    await page.getByTestId('save').click()

    await expect(page.getByTestId('save-bar')).toBeHidden()
    const viewer = await apiAs('viewer')
    const saved = await viewer.get<{ general: { household_name: string } }>('/settings')
    expect(saved.general.household_name).toBe('The Rivera-Chen household')
    await expectAccessible(page)
  })
})
```

When a file's tests only look and change nothing, one reset in a `beforeAll` is enough:

```ts
test.describe('Transactions for a viewer', () => {
  test.use({ storageState: signInFiles.viewer })

  test.beforeAll(async ({ baseline }) => {
    await baseline.reset()
  })

  test('shows last year', async ({ transactionsPage }) => {
    await transactionsPage.goto({ period: 'last-year' })
    // …
  })
})
```

### Starting signed in

Global setup saves two sign-ins before every run, as Playwright storage state files:
`signInFiles.admin` signs in as Alex, an admin, and `signInFiles.viewer` as Sam, a viewer.
They're `e2e/.auth/admin.json` and `viewer.json`, which git ignores, and each holds the
session cookie of a sign-in that's part of the baseline ("Chrome on Windows" in Settings >
Security). Every reset brings that sign-in back with the same cookie, so the files keep
working across resets, even a reset in the middle of a test.

- Signing out, signing out "Chrome on Windows" or everywhere else from another of their
  browsers, or turning the account off ends it until the next reset, as it would for a real
  browser. Reset in `beforeEach` in specs that do.
- Like right after signing in, changes that need a recent password check, such as a new
  password, go through for 10 minutes after a reset. After that the app asks to confirm it's
  you, with the baseline password.
- `signInAs(who)` signs in anyone else, such as Jordan or someone a test invited.

### Fixtures

| Fixture                       | What it gives you                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `baseline`                    | The baseline data above, plus `reset()` and `freshInstall()`, which empties the database as on a first start and returns the setup wizard's code.                                                                                                                                                                                                                                                                                                                                    |
| `signInAs(who, { remember })` | Signs the test's browser in as a baseline person (`'admin'`, `'viewer'`, …) or anyone by `{ email }`, skipping the form, two-step and rate limits. Call it before `page.goto`.                                                                                                                                                                                                                                                                                                       |
| `apiAs(who)`                  | An API client signed in as someone, to set up data or check results without clicking: `get`, `post`, `put`, `patch`, `delete`, with paths like `'/settings'`.                                                                                                                                                                                                                                                                                                                        |
| `shell`                       | The signed-in app's frame: `open('budget')` from the side menu or the phone's bottom bar, `chooseTheme('dark')`, `signOut()`.                                                                                                                                                                                                                                                                                                                                                        |
| `signInPage`                  | The sign-in page: `goto()`, `signIn(user)`, `signInWithPasskey()`, `enterCode(code)`, `useRecoveryCode(code)`, and its `error` and `notice` messages.                                                                                                                                                                                                                                                                                                                                |
| `accountsPage`                | The Accounts tab: `goto()`, `row(name)`, `balance(name)`, `act(name, 'edit')` from an account's menu, `showClosed()`, and the dialog's `fill({ … })` and `save()`.                                                                                                                                                                                                                                                                                                                   |
| `transactionsPage`            | The Transactions tab: `goto(query)` (e.g. `{ page: '2', size: '25' }`), `row(payee)`, `open(payee)`, `nextPage()`, `searchFor(text)`, `choosePeriod(title)`, `openFilters()`, `select(...payees)` then `categorizeSelected(category)` or `deleteSelected()`, and the dialog's `fill({ … })`, `save()` and `deleteOpen()`.                                                                                                                                                            |
| `categoriesPage`              | The Categories tab: `goto()`, `search`, `group(name)`, `category(name)`, `actOnGroup` and `actOnCategory`, `addCategory(group)`, the dialogs' `fillGroup`, `fillCategory` and saves, and `deleteCategory(name, { moveTo })`.                                                                                                                                                                                                                                                         |
| `automationsPage`             | The Automations tab: `goto()`, `card(name)`, `act(name, 'toggle' \| 'edit' \| 'delete')`, and the two-step dialog's `tick(payee)`, `addText(text)`, `findIn({ payees, texts, match, account, amount })`, `next()`, `thenFill({ name, category, subscription, applyTo })`, `fillIn({ … })` for both steps and `save()`.                                                                                                                                                               |
| `budgetPage`                  | The Budget tab: `goto({ budget, on })`, `card(name)`, `choose(name)`, `tile('income' \| 'spent' \| 'net')`, `left`, `source(name)`, `transaction(payee)`, the dialogs' `openNew()`, `openEdit()`, `fillIn({ name, period, amount, startsOn })` and `save()`, and for what counts `openLink('income' \| 'spending')`, `chooseTab(tab)`, `tick(payee)`, `pickIn('account' \| 'category' \| 'subscription' \| 'rule', name)`, `add()`, `takeOff(payee)` and `showTransactions(filter)`. |
| `connectPage`                 | The Connect tab: `goto()`, `card(bank)`, `status(bank)`, `account(bank, name)`, `syncNow(bank)`, `act(bank, 'choose')` from a bank's menu, `remove(bank, { deleteAccounts })`, and the wizard's `startConnecting({ history })`, `chooseAccounts(...names)`, `renameAccount(name, to)`, `importAccounts()` and `finish()`.                                                                                                                                                            |
| `importPage`                  | The Import tab: `goto()`, `chooseFile(file)`, the columns step's `columnMatch(column)`, `matchColumn(column, 'Amount')` and `continue()`, the review step's `chooseAccount(name)`, `row(text)`, `tick(texts, { on })`, `showRows('New')`, `chooseBalance('move')` and `saveFormat(name)`, then `importRows()`, `seeTransactions()` and `close()`, and the lists' `importItem(file)`, `undo(file)`, `format(name)`, `renameFormat(name, to)` and `deleteFormat(name)`.                |
| `plaid`                       | Plaid, as the next section describes: Link's window (`link`), with `connect(bank)`, `signInAgain()`, `close()` and `fail()`, and the banks behind the test server, with `addTransaction({ … })` and `failSyncs(connectionId, code)`.                                                                                                                                                                                                                                                 |

And helpers: `signInFiles` holds the saved sign-ins, `expectAccessible(page)` fails on WCAG
2.2 AA problems that axe finds (pass `{ include: '.v-overlay--active' }` to check just an
open dialog or menu), `totpCode(secret)` makes authenticator codes, `addPasskey(page,
passkey)` gives Chromium a virtual authenticator holding a baseline passkey,
`dateOf(transaction)` gives a baseline transaction's date, `allTransactions(baseline)` lists
every baseline transaction, `choose(field, option)` picks from a select or autocomplete,
`typeDate(field, '2026-09-20')` fills in a date field, and `openOverlays(page)` finds what's in
the dialog or menu that's open: a menu that just closed stays in the page while it fades out,
so `openOverlays(page).getByTestId(…)` won't also match the item in that one.

### Statement files

The Import tab reads files from banks, so specs make up their own, with dates counted back
from today like the baseline's: `csvFile(name, columns, rows)` with any columns a bank might
use (`null` for none), `simpleCsv(name, rows)` with Date, Description and Amount,
`ofxFile(name, rows, { type, number, balance })` for OFX, QFX and QBO downloads, and
`qifFile(name, rows)`. `bankDate(daysAgo)` writes a day the way US banks do, or day first
with `'dmy'`.

```ts
test('an admin imports a bank export', async ({ importPage }) => {
  await importPage.goto()
  await importPage.chooseFile(
    csvFile(
      'chase.csv',
      ['Posting Date', 'Description', 'Amount'],
      [[bankDate(2), 'LA TAQUERIA', '-23.80']],
    ),
  )
  await expect(importPage.columnMatch('Posting Date')).toContainText('Date')
  await importPage.continue()

  await importPage.chooseAccount('Everyday checking')
  await expect(importPage.row('LA TAQUERIA')).toBeVisible()
  await importPage.importRows()
})
```

An OFX file's account number ending in an account's last four digits imports into that
account: `ofxFile('visa.qfx', rows, { type: 'credit_card', number: '4111111111113333' })` goes
to the Rewards Visa. `specs/import.spec.ts` has more examples.

### Plaid

Nothing in the tests reaches Plaid. The test server talks to a stand-in for Plaid's API
(`backend/e2e/plaid.py`) that knows the baseline's two banks and two more to connect, First
Platypus Bank (`'platypus'`) and First Gingham Credit Union (`'gingham'`), each sharing Plaid
Checking, Plaid Saving and Plaid Credit Card with a couple of months of transactions. Every
test's browser gets a stand-in for Plaid Link too: a plain window listing those two banks, or
when Link opens to reconnect a bank, a **Continue** button. The `plaid` fixture drives it:

```ts
test('an admin connects a bank', async ({ connectPage, plaid }) => {
  await connectPage.goto()
  await connectPage.startConnecting({ history: 'Last 90 days' })
  await plaid.connect('platypus')

  await connectPage.chooseAccounts('Plaid Checking', 'Plaid Credit Card')
  await connectPage.importAccounts()
  await connectPage.finish()
  await expect(connectPage.status('First Platypus Bank')).toHaveText('Up to date')
})
```

- `plaid.connect(bank, { onBankWebsite: true })` goes through the app's OAuth redirect page
  (`/connect/oauth`), as banks that sign people in on their own website do.
- `plaid.signInAgain()` finishes reconnecting (**Reconnect**) or sharing other accounts.
  `plaid.close()` closes Link, and `plaid.fail()` closes it with an error, as when the bank
  isn't responding.
- `plaid.addTransaction({ account_id, amount, payee, category })` has an account's bank
  report a new transaction, which the next sync brings in (**Sync now**, or
  `connectPage.syncNow(bank)`). Amounts are as Cashcove shows them, so `'-12.34'` is money
  out; `category` is one of Plaid's, such as `FOOD_AND_DRINK_RESTAURANT`.
- `plaid.failSyncs(baseline.connections.tartan.id, 'ITEM_LOGIN_REQUIRED')` makes a bank's syncs
  fail with that error until it's reconnected, or cleared with `null`.

`specs/connect.spec.ts` has more examples. Resets put the stand-in back to the baseline's
banks.

### Conventions

- Reset in `beforeEach`, or `beforeAll` when a file's tests change nothing, never in
  `afterEach`, so a failed test leaves its data for you to look at.
- Find elements the way people do, by role and name (`getByRole('button', { name: 'Save' })`),
  or by the app's `data-test` attributes with `getByTestId`. Add a `data-test` to a component
  when nothing else identifies it.
- Let Playwright's `expect` wait for things; don't add fixed waits.
- A spec runs on both screen sizes. `await shell.onPhone()` tells you which one you're on,
  and `test.skip(test.info().project.name === 'mobile', 'why')` skips one.
- Put page objects for new tabs in `support/pages/` and export them from `support/index.ts`.

## Adding to the baseline

When a feature adds data (budgets, accounts), give the baseline a small, realistic set
of it:

1. Add the rows to `seed()` in `backend/e2e/baseline.py`, with fixed IDs and dates relative
   to now, and describe them in `describe()` and the `Baseline` model.
2. Add their types to `BaselineData` in `support/harness.ts`.
3. Update the table above, and `backend/tests/test_e2e_harness.py`.

## Coverage

Every run measures what the tests exercised, from the browser and the server:

- **Web app:** `e2e-results/coverage/web/index.html` and `lcov.info`, from Chromium's own
  coverage mapped back to `src/` through source maps.
- **API:** `e2e-results/coverage/api/html/index.html` and `lcov.info`, from coverage.py. It
  counts everything since the test server started, so run `make e2e-down` first for a
  measurement of one run.

`CASHCOVE_E2E_COVERAGE=off npm run e2e` skips it. In CI, the **End-to-end** job uploads the
report, traces and coverage as the `e2e-results` artifact.

## The production image's smoke test

CI's **Container** job also runs `e2e/smoke/` in Chromium against the production image it
built, which has no test harness. On the fresh install, the setup wizard creates the first
admin with the one-time setup code; the admin signs in and opens every tab and settings
page; and the test fails on any error in the browser, Content Security Policy violations
included. After the container restarts on the same data, the admin signs in and goes round
again. `npm run smoke` runs it, given `CASHCOVE_SMOKE_URL`, `CASHCOVE_SMOKE_SETUP_CODE` and
`CASHCOVE_SMOKE_PASSWORD`. It sets up a new install, so point it at a throwaway one, never
your own.

## When something fails

`make e2e-report` opens the report: each failure has a screenshot, a video and a trace you
can step through (`npx playwright show-trace <trace.zip>`). `make e2e-logs` shows the test
server's logs.
