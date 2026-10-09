# Cashcove

Self-hosted personal finance and budgeting, powered by Plaid.

Cashcove runs as **one container**: nginx (HTTPS), the Python API, PostgreSQL and the Vue
web app, managed by supervisord. One `make up` brings the whole thing online.

| Layer    | Stack                                                                   |
| -------- | ----------------------------------------------------------------------- |
| Web app  | Vue 3.5, Vuetify 4, TypeScript 6, Vite 8, Pinia, Vue Router, Lucide     |
| API      | Python 3.14, FastAPI, SQLAlchemy 2.1, Alembic, Pydantic 2               |
| Sign-in  | Argon2id passwords, passkeys, authenticator codes, server-side sessions |
| Database | PostgreSQL 18, on a unix socket only, peer auth, no password to leak    |
| Edge     | nginx mainline, TLS 1.3 only, HSTS, strict CSP (allows Plaid Link only) |
| Image    | Chainguard's Wolfi base, read-only filesystem, scanned by Trivy in CI   |
| Tests    | pytest and vitest at 100% coverage, Playwright end to end, axe          |
| Quality  | SonarQube, ruff, pyright, mypy, bandit, ESLint, vue-tsc, Trivy          |

## Quick start

```sh
cp .env.example .env      # set CASHCOVE_SERVER_NAME and your Plaid keys
make up                   # build and start
make logs                 # shows the one-time setup code
```

Then open `https://<CASHCOVE_SERVER_NAME>/welcome`. Run `make` to see every command.

### First run

Until the first admin exists, anyone who can reach Cashcove could claim it, so the setup
wizard asks for a one-time code that the container prints in its logs. Enter it, create the
admin account, protect it with a passkey or an authenticator app, name your household, and
you're in. `make setup-code` prints a fresh code if the old one expired or scrolled away.

Invite everyone else from **Settings > Users**. Each invitation is a one-time link you send
however you like (Cashcove doesn't send email), and each person is either an **admin**, who
can change anything, or a **viewer**, who sees everything and changes nothing.

Setup also adds 37 suggested categories, such as Groceries and Rent & mortgage, in groups
like Food & drink. Add, rename, regroup or delete categories and their groups on the
**Categories** tab. Until you connect a bank through Plaid, add accounts by hand on the
**Accounts** tab and record their transactions on **Transactions**; an account kept by hand
moves its balance with them.

### Using your own domain

1. Point a DNS record (for example `cashcove.example.com`) at the private IP of the machine
   running Cashcove, and set `CASHCOVE_SERVER_NAME` to exactly that name in `.env`. Passkeys
   are tied to it, so they only work when Cashcove is opened at that address.
2. Get a certificate for that name. Let's Encrypt can't reach a private IP, so use a DNS
   challenge. With DNS at IONOS, create an API key at
   [developer.hosting.ionos.com](https://developer.hosting.ionos.com/docs/getstarted) and run
   [lego](https://go-acme.github.io/lego/), which supports IONOS directly:

   ```sh
   IONOS_API_KEY='<prefix>.<secret>' lego run --accept-tos --email you@example.com \
     --dns ionos --domains cashcove.example.com
   cp .lego/certificates/cashcove.example.com.crt certs/fullchain.pem
   cp .lego/certificates/cashcove.example.com.key certs/privkey.pem
   ```

   Any ACME client with a DNS challenge for your provider works the same way.

3. Run `make restart`. Repeat the same steps from a scheduled job to renew: `lego run`
   renews the certificate when it's close to expiring.

Without a certificate in `./certs`, Cashcove generates a self-signed one for
`CASHCOVE_SERVER_NAME`, and your browser will ask you to trust it.

### Plaid

Cashcove connects to banks through [Plaid](https://plaid.com), using keys of your own. Until
it has them, the **Connect** tab shows how to set it up.

1. Sign up at [dashboard.plaid.com](https://dashboard.plaid.com/signup). A new account gets
   the **sandbox** straight away, with test banks and made-up data. For your real banks, ask
   for production access from the dashboard's home page and include the **Transactions**
   product.
2. Copy your client ID and secret from **Developers > Keys**
   ([dashboard.plaid.com/developers/keys](https://dashboard.plaid.com/developers/keys)). The
   sandbox and production have different secrets, so take the one for the environment you
   use.
3. Add them to `.env` and run `make up` to restart with them:

   ```sh
   CASHCOVE_PLAID_ENV=sandbox          # or production, with the production secret
   CASHCOVE_PLAID_CLIENT_ID=your-client-id
   CASHCOVE_PLAID_SECRET=your-secret
   ```

4. Open **Connect**, choose **Connect a bank**, pick how far back to import (up to two years,
   defaulting to what **Settings > Sync** says), and sign in to the bank in Plaid's window.
   In the sandbox, pick any bank and sign in with `user_good` and `pass_good`. Then tick the
   accounts to import, rename them if you like, and Cashcove brings in their transactions.
   Accounts you leave unticked can be imported later with **Choose accounts**.

Big banks such as Chase and Wells Fargo sign you in on their own website (OAuth). Plaid opens
that in a pop-up window, which works on a computer. To come back to Cashcove in the same tab
instead, which suits phones better:

1. In the dashboard, add `https://<CASHCOVE_SERVER_NAME>/connect/oauth` to **Developers > API
   > Allowed redirect URIs**, with your server's name and any port that isn't 443
   > (`https://cashcove.example.com/connect/oauth`).
2. Set `CASHCOVE_PLAID_OAUTH_REDIRECT=true` in `.env` and run `make up`.

Banks outside the US need their countries in `CASHCOVE_PLAID_COUNTRY_CODES`, a
comma-separated list of Plaid's country codes such as `US,CA` (the default is `US`), and
Plaid has to have enabled them for your account.

Plaid usually pushes changes through webhooks, but a server on a private network can't
receive them, so Cashcove asks Plaid for anything new on a schedule instead: every 6 hours
unless you change it in **Settings > Sync**, where you can also turn it off. **Sync now** on a
bank fetches right away. When a bank wants you to sign in again, the Connect tab and its badge
in the menu say so, as does a bank's card a month before it stops sharing, and **Reconnect**
opens Plaid to fix it.

Now and then a bank connects fine and Plaid still can't get its transactions, as when the bank
changes how it shares them. Plaid answers every request, so nothing looks broken: the accounts
are there, with no transactions. When a bank has never sent any, Cashcove asks Plaid whether
its updates for the bank are failing, and if so the bank's card says so and Cashcove checks
again on the usual schedule rather than every few minutes. Only the bank and Plaid can fix it.
Until they do, [import statement files](#importing-statement-files) from the bank's website.
When the bank does start sharing, the next sync brings in everything from the start. Undo those
file imports then (**Recent imports** on the Import tab), or the days they cover show twice.

Plaid's keys and each bank's access token stay on the server, the tokens encrypted with the
app secret key. The browser only loads Plaid Link from `cdn.plaid.com`, which the Content
Security Policy allows along with the matching Plaid API host. Removing a bank in Cashcove
also removes it at Plaid, so Plaid stops billing for it.

### Accounts in other currencies

Budgets are in the currency chosen in **Settings > General**. Transactions from accounts in any
other currency count toward them too, converted at the exchange rate of the day each one
happened (a transaction from today counts at yesterday's rate until the day is over). The
Budget tab says which currencies it converted. Nothing converted is stored: change an
account's currency or the household's and the budgets follow.

Rates come from [Frankfurter](https://frankfurter.dev), a free, open-source rates service that
needs no key and covers about 165 currencies. Cashcove asks it for one currency's daily rates
over the days that account has transactions, only ever sends currency codes and dates (never
amounts, accounts or anything about you), and keeps what it gets in its own database, so each
day is only ever fetched once. If the rates can't be fetched, those accounts are left out of the
budget and the Budget tab says so, until they can be.

- **Your own rate server:** Frankfurter is MIT-licensed and runs as one container
  (`lineofflight/frankfurter`). Set `CASHCOVE_EXCHANGE_RATE_URL` in `.env` to its address, e.g.
  `http://frankfurter:8080`.
- **No lookups at all:** set `CASHCOVE_EXCHANGE_RATE_URL=` to nothing. Only rates already kept
  are used, so accounts in other currencies count only for days Cashcove already has rates for.

### Dashboard

The **Dashboard** is the first tab, and where you land after signing in. It is for seeing how the
household is doing without opening anything else:

- **Net worth**, with what you have and what you owe, and the accounts with the most in them or
  owed on them.
- **This month**: what came in, what you spent and what is left over, each against the same
  days of last month, and how spending has built up day by day.
- **Income and spending** for each of the last six months, and **where it went**, by category,
  drawn with Vuetify's own sparkline and pie charts. Every chart can also be read as a table.
- **Budgets** and how much of each is spent, the bills and subscriptions **coming up** (or
  overdue), the payees you spent the most with, and your latest transactions. Each links to
  its own tab, and what needs attention, like a bank that wants you to sign in again or
  transactions with no category, is pointed out at the top.

It is worked out from the transactions each time you open it, across every account, so it is
always up to date with what synced, was imported or was sorted by an automation. Money moving
between your own accounts (a category in a transfer group) is neither income nor spending, and
accounts in other currencies are converted as the budgets do.

### Subscriptions, bills and automations

The **Subscriptions** tab keeps track of recurring payments: what each costs, how often, which
account pays it and when the next payment is due, with a reminder beforehand (**Settings >
Alerts** sets how many days). A subscription tracks the payments from its account that have
its payee, and **Link payments** adds ones from any account by hand, or takes them off again.
Linked payments take the subscription's category, and the latest of them moves its due date
on, so the next payment is always the one to come. Open a linked transaction on the
Transactions tab to see which subscription it belongs to.

The **Bills** tab, just under Subscriptions, is the same for what you owe a provider, like
electricity or a phone line, which are usually a different amount each month. A bill is tracked,
matched and linked exactly as a subscription is, and is kept apart from them: bills have their
own reminder (**Settings > Alerts**, five days ahead until you change it), and one that has
gone past its due date with no payment linked is called out at the top of the page. Add a
bill from the payment that paid it, and Cashcove links every other payment like it that's
already there, and each one that comes later, from Plaid, a statement file or by hand. For a
payee that's written differently from one source to the next, an automation links them all.

Both can have a **category**, which their linked payments take. Deleting a category moves the
subscriptions, bills and automations that use it along with its transactions when you choose
somewhere to move them, and otherwise leaves all of them uncategorized.

The **Automations** tab does the sorting for you. Tick the transactions you want sorted (or
type text to look for), say what should happen to them, and Cashcove finds every other
transaction like them:

- **What they get:** a category, a subscription or bill their payments are linked to (only
  money going out is linked), and/or counting toward budgets as income or spending. Any one of
  them is enough.
- **What they look for:** text in a transaction's payee or in what the bank called it, which
  differ between Plaid and statement files ("Amazon" and "AMZN Mktp US\*2K4TT3Y81"): the whole
  of it, the start of it or anywhere in it, ignoring letter case. An automation can also look
  only in one account, or only at an amount or a range of amounts, which tells apart a payee
  that bills several subscriptions, while a bill that changes every month leaves the amount open.
- **Which way the money went:** **Money in** or **Money out** only, or either way. A paycheck
  automation that looks for your employer is for money in, so what you buy from a shop of the
  same name isn't filed as a paycheck or counted as income. Ticking transactions to start an
  automation chooses it for you from them. Only money going out is linked to a subscription or
  a bill, so money in can't be combined with one.
- **Which transactions:** an automation can cover **past and future** transactions, sorting the
  ones you already have as soon as you save it, or **future** ones only, leaving what's there
  alone.
- **When it happens:** as transactions come in, whether Plaid syncs them, a statement file
  brings them or you add them by hand, when the bank changes one it already sent, and when you
  change an automation, or resume a paused one, that covers the past. Importing a file says
  what your automations will do to each row before anything is imported (the category, and the
  subscription or bill a payment is linked to), and how many they sorted afterwards.
- **Counting toward budgets:** the automation's second step also chooses the budgets it counts
  toward, as income or as spending. That is worked out from the transactions it finds, so
  whatever comes in later, from Plaid or from a file, counts without anything else to do.
- **Never takes anything away:** automations only add. A category you choose yourself, such
  as in a transaction's own form, on its details or for several at once on the Transactions
  tab, is kept for good, however often an automation is changed, paused or resumed; taking it
  away hands the transaction back to them. Deleting an automation leaves what it sorted as it
  is.
- **Overlaps are fine:** when several automations would give a transaction a category or a
  subscription, the oldest wins, and the dialog tells you which others already do the same
  thing before you save.

A subscription whose amount changes every time, like electricity, can be set up as such: it
expects what its recent payments averaged, and says when the latest payment wasn't the price
it has (**Update amount** takes the new one). Anything an automation gets wrong is fixed by
hand: choose the subscription or bill on a transaction's details, or select several payments
on the Transactions tab and **Link to subscription or bill**.

### Budgets

A **budget** is an amount for a period of time: every week, two weeks, month or year. Make as
many as you like, such as a monthly one for the household and a yearly one for the year, and
switch between them with the cards at the top of the Budget tab, which show how each is going.

What counts toward a budget is whatever you link to it, as income (money coming in) or as
spending (money going out, which is taken off the amount):

- **Transactions** one at a time, such as a paycheck. Tick **count every later one like them**
  and Cashcove makes an automation, so every later paycheck counts too, whether Plaid syncs it,
  a statement file brings it or you add it by hand.
- **An account**: its money out counts as spending, or its money in as income. Moving money
  between your own accounts, like paying a card, isn't counted.
- **A category**, a **subscription** or a **bill** (its payments, and the ones still to come
  this period), or an **automation**, which counts everything it finds, including what arrives
  later.

A transaction counts once toward a budget, however many of those link it, and can count toward
several budgets at once. Take one off a budget, even one that an account or category counts,
and it stops counting there only. It's listed under **Taken off**, where you can put it back.

Periods follow transaction dates, so you can look back at earlier ones, and the amount is
measured against what was counted that period. Changing a budget's amount applies from the
period you're in, so earlier periods keep what they had. For each period the tab shows what's
left to spend, spending against an even pace through the period, income and spending in each
of the latest periods, where the money went, and the bills still to come, and every chart has
a table view that reads the same numbers. **Settings > General** sets the first day of the
week and the month the budget year starts in, and **Settings > Alerts** how much of the amount
counts as close to it.

### Importing statement files

The **Import** tab brings in transactions from files downloaded from a bank's website: for
accounts Plaid can't reach, or history from before a bank was connected. Nothing needs
setting up.

- **Formats:** CSV (including tab-separated and `.txt` exports), OFX, QFX, QBO and QIF, up to
  5 MB a file. Spreadsheets can't be read, so download CSV or OFX instead, usually from
  **Download** or **Export** on the account's activity page.
- **PDF statements** are read by the [AI](#ai-optional), once an admin has set it up (up to 60
  pages and 10 MB, with the transactions as text, not a scan). It takes the transactions off the
  PDF, you check every one and choose the account, and nothing is added until you do. Without AI,
  choosing a PDF says it can only be read with AI, and nothing else changes.
- **Any bank's CSV:** Cashcove matches the columns by their names and what's in them: dates in
  any order, amounts in one column, in separate money in and money out columns, or beside a
  column saying which way the money went (Debit or Credit, CR or DR), decimal commas, and
  lines to skip above the transactions. You check or change what each column holds, and it's
  saved as a format for that bank, so its next file goes straight to review.
- **Review:** Choose the account (an OFX file or a PDF statement finds it by its last four
  digits), see which rows are new, which the account already has and which it might, and tick
  what to import. Possible duplicates, including rows with the same date, payee and amount,
  start unticked; review them and tick any that are separate transactions.
  Rows identified by an already-used bank transaction ID or repeated inside the file can't be
  imported. Leaving possible matches unticked means importing the same file again adds nothing.
- **Balances:** For an account kept by hand, take the file's closing balance, add what's
  imported, or leave the balance as it is. A linked account's balance stays as Plaid reports
  it.
- **Linked accounts:** Plaid shares up to two years of history. Importing the bank's older
  statements into a linked account fills in what came before; rows on days Plaid already
  covers start unticked.
- **Undo:** Each import in **Recent imports** can be undone, which deletes what it added and
  puts the balance back.

Imported transactions are ordinary transactions: they show on the Transactions tab and count
wherever the others do. Viewers see the imports and saved formats but can't import or change
them.

### AI (optional)

AI is **off until an admin turns it on**, and Cashcove works exactly the same without it. With
it, the **AI** tab (which only admins can open) answers questions about your money, reads a PDF
bank statement into transactions for you to check, gives a second opinion on how your
transactions are sorted, and shows what it all cost, an import can end with that second opinion,
transactions can be found by describing them, and automations can be suggested from what you
keep choosing by hand. Until AI is set up, each of its pages says what to do first (and that
these can only be used with AI), and nothing else in Cashcove depends on it, or shows any sign
of it.

**Settings > AI** (admins only) chooses where the AI runs:

| Provider                    | What you give it                                         | Models                                                                          |
| --------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| **Ollama on your computer** | Its address, such as `http://host.docker.internal:11434` | Any that can chat: **Fetch models** lists what the server has, and you pick one |
| **Ollama Cloud**            | An API key from ollama.com                               | **Fetch models** lists its catalog, each with its price                         |
| **Anthropic**               | An API key from the Claude Console                       | **Claude Haiku 4.5** (the default) and Claude Sonnet 5.5                        |
| **OpenAI**                  | An API key from the OpenAI platform                      | **GPT-6 Luna** (the default), GPT-5.6 Luna, GPT-5.4 mini and other small ones   |

Only small, inexpensive models are offered, because the work is short: no Opus, Fable or large
GPT. Every provider has a **Test connection** button that tries what is in the form before it is
saved, so a wrong key or address shows up there. A key is encrypted with the app secret before it
is saved and is never sent back to the browser. A model its provider is shutting down is marked
with the date and what to use instead.

**Ollama on the same computer** needs an address the container can reach: inside the container,
`localhost` is the container itself. Use `http://host.docker.internal:11434` (`docker-compose.yml`
makes that name work on Linux too) and let Ollama listen beyond loopback with
`OLLAMA_HOST=0.0.0.0`. The browser never talks to an AI provider, only Cashcove's server does, so
the Content Security Policy is unchanged, and the API waits up to five minutes for a slow model.

What the **AI** tab does. It is **for admins**: it isn't in anyone else's navigation, its address
sends them to the Dashboard, and the API behind it (the chat, what the AI suggested, the cost)
refuses them. Viewers can still see whether AI is set up, and find transactions in plain words
on the Transactions tab, which only picks filters.

- **Ask**: a chat about your finances. It answers from a fresh summary of your records (spending
  by month and category, the payees you spent most with, budgets, subscriptions and bills, and the
  latest transactions) and explains what the numbers show. It isn't financial advice.
- **Read a PDF statement** (admins): attach a PDF with the paperclip, choose it with **Choose a
  PDF**, or drop it on the conversation, and the AI takes the transactions off it. The chat says
  what is happening while it works, for how long, and what stays on this computer, and can stop
  it. Then it says what it found: how much came in and went out, which account it looks like and
  how many rows need a look. **Review and import** opens the same review as the Import tab, where
  you choose the account, correct a row's date, payee, amount or which way the money went (a
  pencil on each), flip every row's direction if the statement came out the wrong way round, and
  tick what to add. **Nothing is added until you do**, and duplicates, automations, balances and
  undo work as they do for any file. A scan or a photo has no text to read, and says so: download
  the statement as a PDF with text in it, or as CSV, OFX or QFX. A long statement is read a batch
  at a time within five minutes, and a model too slow for it says so rather than timing out.
- **Recommendations**: the AI looks over transactions nobody chose a category for, such as ones an
  automation left alone, and suggests a category for each, with how confident it is and why. Ask
  for a review of recent or uncategorized transactions, then **Apply** or **Dismiss** each
  suggestion, or tick several. **Nothing changes until an admin applies one.** A category you
  chose yourself is never reviewed, a transaction that changed since is left alone, and one you
  dismissed isn't suggested again. Waiting suggestions show on the Dashboard.
- **Importing a file** ends with an **AI second opinion** step: your automations sort the rows as
  they come in, then the AI looks over how they were sorted and suggests changes, which you can
  apply right there or leave for the AI tab. Turn it off in Settings > AI, and without AI the
  import has the steps it always had.
- **Usage**: tokens and an estimated cost by day, model and purpose, at each provider's published
  list price (Anthropic, OpenAI and Ollama Cloud; Ollama on your computer costs nothing). It's an
  estimate: your provider's bill is what counts.

Two more things AI does are where the work is, and only show once AI is set up:

- **Find transactions in your own words** (the Transactions tab): **Find with AI** beside the
  filters opens a box to describe what you're after, like "groceries over $50 last month". The AI
  turns the words into the tab's own filters (words to look for, categories, dates, how big, which
  way the money went, where it came from, and the order), which replace the ones that were on and
  show as the chips the tab already has, to take off or change, and are kept in the address like
  any others. It finds no transaction itself, each filter is checked before it's used, and
  anything it couldn't use is said rather than guessed at. Anyone who can see transactions can use
  it. The accounts and banks you name ("my Visa") are found by Cashcove, not the AI.
- **Suggest automations** (the Automations tab, admins): **Suggest with AI** looks for payees you
  put in the same category by hand at least three times, nearly always the same one, that no
  automation sorts already, and has the AI word each as a rule: the text to look for, how to
  compare it, and a name. Each suggestion shows how many times you chose it, how many
  transactions with no category it would sort now, how many it matches that you put elsewhere (and
  would leave alone), and any older automation that already gives some of them a category.
  **Review and create** opens the form for a new automation with it filled in, so **nothing is
  created until you save it**.

#### What never reaches an AI

**Account numbers and bank names never leave Cashcove.** Everything above works without telling an
AI which account or bank anything came from, and four guardrails keep it that way:

1. **It only reads what it needs.** What an AI is sent is built from a short list of fields:
   dates, amounts, payees, the names of categories, budgets, subscriptions and bills, and what you
   type. It's never built from an account, a bank connection, a balance or a transaction's raw bank
   description or notes.
2. **Scrubbing.** Free text that came from a bank, a file or a person (a payee, your question)
   loses anything that looks like an account or card number, the last digits of one (`•••• 4410`,
   `x4410`, `ending in 4410`), an email address or a key, and **the name of every account and bank
   you've set up in Cashcove**. A payee called after your credit union becomes `[account]`.
3. **A last check.** Just before a request leaves, everything in it that came from your records is
   checked again. If an account number, its last digits or an account or bank name is still in it,
   the request is **refused and nothing is sent**, and you're told. This is what catches a mistake
   made anywhere else.
4. **It only suggests.** An AI never changes anything itself. Suggestions wait in the database for
   an admin to apply or dismiss, and a key never goes anywhere but the provider it belongs to, in
   a header, never in what is asked.

#### Finding transactions and suggesting automations

- **A search** sends the words you typed, with the same things taken out as anywhere else, and the
  names of your categories. The accounts and banks a question names are found here, by the name of
  an account or of its bank, or a word only that account's name has, and those words are left out
  of what is sent. A question that only names accounts isn't sent at all. What comes back is only
  filters: a category has to be one you have, a day one that makes sense, and nothing in it finds
  or changes a transaction.
- **A suggestion** sends each payee as written, with the same things taken out, the name of the
  category you put it in, how many times and for how much. The category and the way the money went
  are yours, never the AI's: it only words what to look for, which is tried on your transactions
  before it's offered and dropped unless it covers what you chose and little you chose otherwise.
  Nothing is asked of the AI when no payee has been chosen for often enough.

#### Reading a PDF statement

A statement says more about you than anything else an AI could be shown: the bank, your name and
address, the account number, balances. So it is read here, and the AI is only ever sent less than
a bank statement's transactions:

- **The PDF stays on the server.** Cashcove takes its text out itself, with no AI, and a PDF with
  no text (a scan or a photo) is refused rather than sent as a picture.
- **Only the transaction lines go**, each a date, a description and its amounts. The header (the
  bank, the holder, the address, the account number), summaries, totals and every running balance
  are left out, and a line's balance is replaced by `[balance]`.
- **Each line is scrubbed first**: account and card numbers, phone numbers, ID numbers, street
  addresses, email addresses, the name of every account and bank you've set up, **the name of
  everyone in your household**, and the name after `Zelle to`, `Venmo`, `PayPal`, `Cash App` or a
  wire become `[account]`, `[person]`, `[address]` or `[hidden]`. The same last check refuses the
  request if anything is still in it.
- **The account is found here**: from the last digits on the statement and the bank's name, matched
  to the accounts you've set up. It's a suggestion you can change in the review, and it never goes
  to the AI. If nothing matches, you choose the account.
- **Which way the money went is read here** too, from the statement's own columns (Withdrawals and
  Deposits, or CR and DR), and the AI is told `(in)` or `(out)`. A minus sign isn't treated as
  certain, since banks use it both ways.
- **What comes back is checked**: an amount must be one that is on the line it names, a date far
  outside the statement's dates says it needs a look, and anything unsure is flagged in the
  review. The AI can be wrong, which is why every row is yours to check.

Cashcove can only recognize the accounts and banks you've set up, so a payee that names some other
bank is treated as the payee it is, and the dates, amounts and payees an AI is sent are real. To
keep those at home too, use Ollama on your own computer. Settings > AI shows what is and isn't
shared, and the tests prove it: every request that Cashcove's stand-in for Anthropic, OpenAI and
Ollama receives is kept, and the tests fail if any account number, account name or bank name is in
one.

## Security

Cashcove holds financial data and bank connections, so it's locked down even on a home
network.

- **Passwords** are hashed with Argon2id (RFC 9106's 64 MiB profile). New ones follow NIST
  SP 800-63B: at least 12 characters, not a common password, and not built from your name,
  email or "Cashcove". Changing your password signs out your other devices.
- **Passkeys** sign you in with a fingerprint, face or screen lock, and can't be phished.
  **Authenticator apps** add a 6-digit code after the password, with 10 one-time recovery
  codes for a lost phone. Their keys are encrypted before they reach the database.
- **Sessions** live in Postgres behind an HttpOnly, Secure, SameSite=Strict cookie. Every
  change also needs a CSRF token and a request from Cashcove's own origin. You're signed
  out after an hour without activity and after 12 hours at most, or after 14 days without
  activity and 30 days at most on a device you asked to remember. Changing your password,
  passkeys or two-step settings asks you to confirm it's you first.
- **Guessing** is slowed per email address and per client address: after a few free
  attempts, each failure locks sign-in for twice as long as the last, up to 15 minutes, and
  nginx caps how often one address can try at all.
- **AI** is optional and server-side only: a provider's key is encrypted before it's saved and
  never shown again, and no account number, account name or bank name is ever sent to a provider
  (see [AI](#ai-optional)). Only admins set it up, review transactions or apply what it suggests.
- **Roles** are checked by the API on every request, and Cashcove always keeps at least one
  active admin. **Settings > Security** shows your devices and recent activity, and admins
  see the household's in **Settings > Users**.
- **The edge** serves TLS 1.3 only, with HSTS and a Content Security Policy that lets the
  browser run Cashcove's own code and Plaid Link, nothing else. The health check reports no
  version.
- **The image** starts from Chainguard's Wolfi, upgrades every package at build time, keeps
  build tools out, and runs with a read-only filesystem, only the Linux capabilities it
  needs and no privilege escalation. CI scans
  the source, the dependencies and the image with Trivy and fails on any fixable high or
  critical finding; `make scan` runs the same scans locally.

### Locked out

Another admin can create a password reset link or turn off two-step verification for you
in **Settings > Users**. If you're the only admin, run one of these on the server:

```sh
make reset-link EMAIL=you@example.com     # prints a one-time password reset link
make turn-off-2fa EMAIL=you@example.com   # turns off authenticator codes
```

Both are recorded in the activity log.

## Development

```sh
make dev      # the same single container, with Vite hot reload and API auto-reload
make install  # or install dependencies locally to run tests and linters outside Docker
make test     # pytest (on a throwaway Postgres in Docker) + vitest, both at 100% coverage
make e2e      # Playwright end-to-end tests against a test server built from the image
make lint     # ruff, pyright, mypy, bandit, ESLint, Prettier, vue-tsc, hadolint, ShellCheck, actionlint
make audit    # pip-audit and npm audit
make scan     # Trivy on the source, dependencies, Dockerfile and built image
```

Every pull request runs the same checks in GitHub Actions (`.github/workflows/ci.yml`):
the **Backend** and **Frontend** jobs run the linters, type checkers, dependency audits and
tests with 100% coverage; the **Container** job scans with Trivy, builds the image, starts
it with `docker compose`, goes through the setup wizard in a browser, signs in and opens
every tab, and smoke-tests TLS, the API, sign-in, the redirect and the security headers,
before and after a restart; the **End-to-end** job runs the Playwright tests; and the
**SonarQube** job holds the code to SonarQube's quality gate and fails a pull request with
any open issue.

A web app test fails if anything it runs prints a warning or error, whether Vue, Vuetify or
jsdom, so vitest's output stays clean. The message says what was printed.

`make dev` mounts `backend/app`, `backend/migrations` and `frontend/` into the container,
so edits reload instantly at `https://localhost`. API docs are at `/api/docs` in dev.

### End-to-end tests

The Playwright tests start every spec from the same baseline data (a household with two
admins, a viewer, a turned-off account and a pending invitation, their devices, passkey and
activity, plus six accounts, the suggested categories and a year of transactions), which a
before block resets. Saved sign-in files start a spec signed in as the admin or the viewer
with `test.use`, fixtures sign the browser in as anyone and call the API as anyone, and
coverage of both the web app and the API is collected; every page is also checked for
accessibility problems. Plaid and the AI providers are stand-ins that answer from memory, so
nothing reaches either.
[frontend/e2e/README.md](frontend/e2e/README.md) covers running them, the baseline and
writing specs.

### Code quality

The **SonarQube** job sends every pull request and every push to master to
[SonarQube Cloud](https://sonarcloud.io), free for public repositories, with both test
suites' coverage, and fails when the code misses its quality gate. After every analysis,
the job's log lists the new code's open issues and security hotspots, plus, on a pull
request, any open issues master still has. A pull request with any open issue of its own
fails too, even one the gate lets through, such as a code smell.
Marking an issue accepted or a false positive in SonarQube Cloud takes it off the list.

`sonar-project.properties` sets what's checked: the API, migrations, web app, container
files and workflows as code, and the unit tests, Playwright tests and end-to-end harness as
tests. Coverage counts everything except the migrations and scripts, which have no unit
tests. The free plan analyzes master and pull requests into master. To turn it on:

1. Sign in to SonarQube Cloud with GitHub, import your GitHub account as an organization,
   and analyze this repository.
2. In the project's **Administration > Analysis Method**, turn off **Automatic Analysis**,
   since CI runs it.
3. Create a token (**My Account > Security**) and add it to the repository as the
   `SONAR_TOKEN` Actions secret (**Settings > Secrets and variables > Actions**).
4. If SonarQube Cloud's organization or project key differs from the ones in
   `sonar-project.properties`, change them there.

Until the secret exists, the job skips the analysis.

### Layout

```
backend/     FastAPI app (app/), Alembic migrations, pytest suite, e2e test harness (e2e/)
frontend/    Vue + Vuetify app (src/), vitest suite, Playwright tests (e2e/)
docker/      entrypoint, nginx templates, supervisord programs, healthcheck, e2e image files
.github/     CI and release workflows, the container smoke test
Dockerfile   frontend build, backend build, runtime, dev and e2e stages
```

### Database migrations

```sh
cd backend
uv run alembic revision --autogenerate -m "describe the change"
```

Migrations run automatically every time the container starts. Write them so they can be run
again on a database that already has some or all of the change: Alembic's `if_not_exists` and
`if_exists` options on `add_column`, `create_index`, `drop_index` and the like, and a
constraint dropped if it exists before it's created (`20261005_0012_bills.py` shows each). CI
applies the newest migration a second time over a database that already has it, so one that
can't be run again fails there. Migrations before it weren't written that way and are left as
they were, since a database never runs one it has already passed.

## Releases

Publishing a release on GitHub builds the image and pushes it to GitHub's container
registry (`.github/workflows/release.yml`):

1. Move what's under **Unreleased** in `CHANGELOG.md` under the new version and date, and
   set the version in `backend/pyproject.toml`, `backend/app/__init__.py` and
   `frontend/package.json` (and their lockfiles).
2. Draft a release with a new tag like `v1.4.0` (or `v2.0.0-rc.1` for a pre-release).
3. Publish it. GitHub doesn't run workflows for drafts, so publishing starts the build.

The workflow builds the image, scans it with Trivy, starts it and smoke-tests it, then
builds it for `linux/amd64` and `linux/arm64` and pushes `ghcr.io/brianbaggs35/cashcove`
tagged `1.4.0`, `1.4`, `1` and `latest` (pre-releases only get their own tag), with a
software bill of materials and signed build provenance. The image reports the release's
version on **Settings > System**. Only the production stages go in: Node and the other
build tools stay in the build stages.

To run a release instead of building the image yourself, set these in `.env` and run
`make pull`:

```sh
CASHCOVE_IMAGE=ghcr.io/brianbaggs35/cashcove
CASHCOVE_VERSION=1.4.0
```

New packages on GitHub start out private: make it public under the package's settings, or
`docker login ghcr.io` first. `gh attestation verify oci://ghcr.io/brianbaggs35/cashcove:1.4.0
--owner brianbaggs35` checks an image was built by this repository's workflow.

## Operations

- `make backup` writes a `pg_dump` to `./backups/`.
- The container creates an app secret key on first start, in the data volume at
  `/data/secrets/secret.key`. It encrypts authenticator-app keys, so a restored database
  needs it too. Run `make secret-key` and keep the value somewhere safe apart from your
  backups, such as a password manager. To move to a new server, set it as
  `CASHCOVE_SECRET_KEY` in `.env`.
- `make logs`, `make ps`, `make shell` and `make psql` help when something looks wrong.
- Data lives in the `cashcove-data` Docker volume and survives `make down` and rebuilds.
