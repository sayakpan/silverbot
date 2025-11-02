import { chromium } from 'playwright';
import pLimit from 'p-limit';
import { sleep, jitter, readCSV, readJSON } from './util.js';
import { loginWithModal } from './login-modal.js';
import { openDiam11AndSelectMatch } from './navigate-game.js';
import { createTeam } from './create-team.js';
import { joinContestByAmount } from './join-contest.js';
import { appendResultRow } from './result-logger.js';

export async function runAll({ env, onlyLogin = false }) {
    const BASE_URL = env.BASE_URL || 'https://silverbet777.club';
    const HEADLESS = String(env.HEADLESS || 'false') === 'true';
    const MAX_CONCURRENT = Number(env.MAX_CONCURRENT || 3);

    const accounts = readCSV('config/accounts.csv');
    const selectors = readJSON('config/selectors.json');
    const team = safeReadJSON('config/team.json'); // optional file

    const browser = await chromium.launch({
        headless: HEADLESS,
        args: ['--disable-blink-features=AutomationControlled']
    });

    const limit = pLimit(MAX_CONCURRENT);
    const tasks = accounts.map((acc, idx) =>
        limit(() =>
            runOne(browser, idx, acc, {
                BASE_URL,
                selectors,
                team,
                onlyLogin,
                matchTitle: team.matchTitle
            })
        )
    );

    await Promise.all(tasks);
    await browser.close();
}

async function runOne(browser, index, account, ctx) {
    const { BASE_URL, selectors, team, onlyLogin, matchTitle } = ctx;
    const context = await browser.newContext({ viewport: { width: 1300, height: 850 } });
    const page = await context.newPage();
    const t0 = Date.now();
    let step = 'init';

    try {
        await loginWithModal(page, BASE_URL, selectors, account.username, account.password);
        step = 'login_done';
        const matchTitleRegex = new RegExp(matchTitle, 'i');
        const frame = await openDiam11AndSelectMatch(page, selectors, matchTitleRegex);
        step = 'match_opened';
        const result = await createTeam(frame, selectors, team);
        step = 'team_created';
        const gameFrame = result.frame;
        await joinContestByAmount(gameFrame, team.contestAmount, result.status);
        step = 'contest_joined';

        console.log(`OK flow-start: ${account.username}`);
        await appendResultRow('artifacts/results.csv', {
            timestamp: new Date().toISOString(),
            match_title: matchTitle,
            username: account.username,
            status: 'success',
            step: step,
            duration_ms: Date.now() - t0
        });

    } catch (e) {
        const message = e?.message || String(e);
        console.error(`FAIL ${account.username}: step=${step} error=${message}`);

        await appendResultRow('artifacts/results.csv', {
            timestamp: new Date().toISOString(),
            match_title: matchTitle,
            username: account.username,
            status: 'fail',
            step: step,
            duration_ms: Date.now() - t0
        });

        try {
            await page.screenshot({
                path: `artifacts/fail-${Date.now()}-${sanitize(account.username)}-${step}.png`,
                fullPage: true
            });
        } catch {}
    } finally {
        await context.close();
        await sleep(jitter(250, 800));
    }
}

function sanitize(s) {
    return String(s).replace(/[^a-z0-9_\-\.]+/gi, '_');
}

function safeReadJSON(p) {
    try {
        return readJSON(p);
    } catch {
        return null;
    }
}