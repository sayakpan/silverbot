# SilverBot (Playwright)

## Prerequisites
- Node 18+
- `npx playwright install chromium`

## Env
Edit `.env`:
- BASE_URL=https://allpanel777.now/
- HEADLESS=true|false
- MAX_CONCURRENT=number

## Configure
- `config/accounts.csv` with username,password rows
- `config/team.json` choose match, contest, players, captain, viceCaptain
- `config/selectors.json` put real selectors (login is prefilled)

## Run
- `npm run test:login` to verify login only
- `npm run run` to run all steps for all accounts (team/contest coming next)

## Artifacts
- Screenshots in `artifacts/` on failures