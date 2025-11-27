import { chromium } from 'playwright';
import pLimit from 'p-limit';
import { sleep, jitter, readCSV, readJSON } from './util.js';
import { loginWithModal } from './login-modal.js';
import { openDiam11AndSelectMatch } from './navigate-game.js';
import { createTeam } from './create-team.js';
import { joinContestByAmount } from './join-contest.js';
import { appendResultRow, appendFailedCredential, clearFile } from './result-logger.js';
import { promises as fsp } from 'fs';

export async function runAll({ env, onlyLogin = false, fromFailed = false }) {
    const BASE_URL = env.BASE_URL || 'https://silverbet777.club';
    const HEADLESS = String(env.HEADLESS || 'false') === 'true';
    const MAX_CONCURRENT = Number(env.MAX_CONCURRENT || 3);

    const failedPath = 'artifacts/last_failed.csv';
    const nextFailedPath = fromFailed ? 'artifacts/next_failed.csv' : failedPath;

    console.log("Failed Run:", fromFailed)

    if (fromFailed) {
        await clearFile(nextFailedPath);
    } else {
        await clearFile(failedPath);
    }

    const accounts = await loadAccounts(fromFailed, failedPath);
    const selectors = readJSON('config/selectors.json');
    const team = safeReadJSON('config/team.json'); // optional file
    if (!team || !team.matchTitle || !team.players || !team.captain || !team.viceCaptain || typeof team.contestAmount !== 'number') {
        throw new Error('Invalid or missing config/team.json. Required: matchTitle, players, captain, viceCaptain, contestAmount');
    }

    console.log(
        `Starting run: match="${team.matchTitle}", contestAmount=${team.contestAmount}, accounts=${accounts.length}, headless=${HEADLESS}, max_concurrent=${MAX_CONCURRENT}`
    );

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
                matchTitle: team.matchTitle,
                failedOutPath: nextFailedPath
            })
        )
    );

    await Promise.all(tasks);
    await browser.close();

    // finalize failed-set file behavior
    if (fromFailed) {
        try {
            // If we produced a fresh set this run, replace last_failed.csv with it
            const stat = await fsp.stat(nextFailedPath).catch(() => null);

            if (stat && stat.size > 0) {
                // Ensure target dir exists (usually already does)
                await fsp.rename(nextFailedPath, failedPath);
            } else {
                // No failures this run -> ensure last_failed.csv is cleared
                await fsp.unlink(failedPath).catch(() => { });
                // Also remove empty temp if it exists
                await fsp.unlink(nextFailedPath).catch(() => { });
            }
        } catch {
            // As a fallback, ensure temp file is removed if present
            await fsp.unlink(nextFailedPath).catch(() => { });
        }
    }
}

async function runOne(browser, index, account, ctx) {
    const { BASE_URL, selectors, team, onlyLogin, matchTitle, failedOutPath } = ctx;
    const context = await browser.newContext({ viewport: { width: 1300, height: 850 } });
    const page = await context.newPage();
    const t0 = Date.now();
    let step = 'init';

    try {
        await loginWithModal(page, BASE_URL, selectors, account.username, account.password);
        step = 'login_done';

        const matchTitleRegex = new RegExp(matchTitle, 'i');
        const matchId = team.matchId ? String(team.matchId) : null;
        const frame = await openDiam11AndSelectMatch(page, selectors, matchTitleRegex, matchId);
        step = 'match_opened';

        if (onlyLogin) {
            console.log(`Test Success For: ${account.username}`);
            await appendResultRow('artifacts/results.csv', {
                timestamp: new Date().toISOString(),
                match_title: matchTitle || '',
                username: account.username,
                status: 'test success',
                step: step,
                duration_ms: Date.now() - t0
            });
            await context.close();
            return;
        }

        const result = await createTeam(frame, selectors, team);
        step = 'team_created';
        const gameFrame = result.frame;
        await joinContestByAmount(gameFrame, team.contestAmount, result.status);
        step = 'contest_joined';

        console.log(`Success For: ${account.username}`);
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
            await appendFailedCredential(failedOutPath, {
                username: account.username,
                password: account.password
            });
        } catch { }

        try {
            await page.screenshot({
                path: `artifacts/images/${sanitize(account.username)}-fail-${Date.now()}-${step}.png`,
                fullPage: true
            });
        } catch { }
    } finally {
        await context.close();
        await sleep(jitter(250, 800));
    }
}

async function loadAccounts(fromFailed, failedPath) {
    if (fromFailed) {
        try {
            const rows = readCSV(failedPath);
            if (!rows.length) throw new Error('no_failed_accounts');
            return rows;
        } catch {
            throw new Error('no_failed_accounts_file');
        }
    }
    return readCSV('config/accounts.csv');
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