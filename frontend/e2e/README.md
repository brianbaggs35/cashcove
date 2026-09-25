# End-to-end tests

Playwright drives the real app in Chromium, on a computer-sized screen (`desktop`) and a
phone (`mobile`, a Pixel 7), against a test server built from the production image. Every
spec starts from the same **baseline** data, so you always know what's in the database.

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

| Who           | In `baseline`         | Role   | Notes                                        |
| ------------- | --------------------- | ------ | -------------------------------------------- |
| Alex Rivera   | `users.admin`         | Admin  | Password only                                |
| Jordan Rivera | `users.two_step`      | Admin  | Authenticator app and ten recovery codes     |
| Sam Rivera    | `users.viewer`        | Viewer | Read-only everywhere                         |
| Casey Rivera  | `users.deactivated`   | Viewer | Turned off, so can't sign in                 |
| Riley Chen    | `invitations.pending` | Viewer | Invited by Alex two days ago, not yet joined |

- The household is called **The Rivera household** (`baseline.household_name`).
- Everyone signs in with the password in `baseline.users.<key>.password`.
- Jordan's authenticator key is `baseline.users.two_step.totp_secret`; `totpCode(secret)`
  gives the current code. Each recovery code in `recovery_codes` works once per reset.
- Riley's invitation link is `baseline.invitations.pending.link`.

Read values from `baseline` rather than copying them into specs, so the baseline can change
without breaking them. It's defined in `backend/e2e/baseline.py`.

## Writing a spec

Specs live in `e2e/specs/` and import everything from `../support`:

```ts
import { expect, expectAccessible, test } from '../support'

test.describe('Household settings', () => {
  test.beforeEach(async ({ baseline }) => {
    await baseline.reset()
  })

  test('an admin renames the household', async ({ page, signInAs, apiAs }) => {
    await signInAs('admin')
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

### Fixtures

| Fixture                       | What it gives you                                                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `baseline`                    | The baseline data above, plus `reset()` and `freshInstall()`, which empties the database as on a first start and returns the setup wizard's code.                              |
| `signInAs(who, { remember })` | Signs the test's browser in as a baseline person (`'admin'`, `'viewer'`, …) or anyone by `{ email }`, skipping the form, two-step and rate limits. Call it before `page.goto`. |
| `apiAs(who)`                  | An API client signed in as someone, to set up data or check results without clicking: `get`, `post`, `put`, `patch`, `delete`, with paths like `'/settings'`.                  |
| `shell`                       | The signed-in app's frame: `open('budget')` from the side menu or the phone's bottom bar, `chooseTheme('dark')`, `signOut()`.                                                  |
| `signInPage`                  | The sign-in page: `goto()`, `signIn(user)`, `enterCode(code)`, `useRecoveryCode(code)`, and its `error` and `notice` messages.                                                 |

And helpers: `expectAccessible(page)` fails on WCAG 2.2 AA problems that axe finds (pass
`{ include: '.v-overlay--active' }` to check just an open dialog or menu), and
`totpCode(secret)` makes authenticator codes.

### Conventions

- Reset in `beforeEach`, never in `afterEach`, so a failed test leaves its data for you to
  look at.
- Find elements the way people do, by role and name (`getByRole('button', { name: 'Save' })`),
  or by the app's `data-test` attributes with `getByTestId`. Add a `data-test` to a component
  when nothing else identifies it.
- Let Playwright's `expect` wait for things; don't add fixed waits.
- A spec runs on both screen sizes. `await shell.onPhone()` tells you which one you're on,
  and `test.skip(test.info().project.name === 'mobile', 'why')` skips one.
- Put page objects for new tabs in `support/pages/` and export them from `support/index.ts`.

## Adding to the baseline

When a feature adds data (accounts, transactions, budgets), give the baseline a small,
realistic set of it:

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

## When something fails

`make e2e-report` opens the report: each failure has a screenshot, a video and a trace you
can step through (`npx playwright show-trace <trace.zip>`). `make e2e-logs` shows the test
server's logs.
