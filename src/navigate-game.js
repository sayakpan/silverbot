import { sleep } from './util.js';

function ensureString(name, v) {
    if (typeof v !== 'string' || !v.trim()) {
        throw new Error(`selector "${name}" is missing or not a non-empty string`);
    }
}

export async function openDiam11AndSelectMatch(page, selectors, matchTitleRegex, matchId) {
    if (!page) throw new Error('page not provided');
    const s = selectors?.game;
    if (!s) throw new Error('selectors.game is missing');

    ensureString('game.ourUrl', s.ourUrl);
    ensureString('game.ourContainer', s.ourContainer);
    ensureString('game.diam11Card', s.diam11Card);
    ensureString('game.diam11PlayIcon', s.diam11PlayIcon);
    ensureString('game.embeddedFrameUrlRe', s.embeddedFrameUrlRe);
    ensureString('game.matchListContainer', s.matchListContainer);
    ensureString('game.matchLink', s.matchLink);
    ensureString('game.postEntrySentinel', s.postEntrySentinel);

    // 1) Go to /fantasy/our
    await page.goto(s.ourUrl, { waitUntil: 'load' });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });

    // 2) Ensure container is visible
    const ourRoot = page.locator(s.ourContainer).first();
    await ourRoot.waitFor({ state: 'visible', timeout: 15000 });

    // 3) Hover DIAM11 tile and click the play icon
    const diamCard = page.locator(s.diam11Card).first();
    await diamCard.waitFor({ state: 'visible', timeout: 10000 });
    await diamCard.hover({ timeout: 5000 }).catch(() => { });
    const playIcon = page.locator(s.diam11PlayIcon).first();
    await playIcon.click({ timeout: 8000 });

    // 4) Wait for the embedded iframe from realteam11 to appear
    // Wait for the iframe element that holds the embedded game
    const iframeEl = page.locator('iframe[src*="realteam11.com"]').first();
    await iframeEl.waitFor({ state: 'visible', timeout: 20000 });

    // Get its frame handle safely
    const frame = await iframeEl.contentFrame();
    if (!frame) throw new Error('embedded_frame_not_found');

    await sleep(400);
    // Wait until the matches list becomes visible inside that frame
    await frame.locator('.league-names.inner-matches-list').waitFor({
        state: 'visible',
        timeout: 20000,
    });

    // Optional: small pause to let frame hydrate
    await sleep(1000);

    // 5) Inside the frame, find the match by its title text and click
    // Example: /Australia vs India T20I/i
    const listing = frame.locator(s.matchListContainer).first();
    await listing.waitFor({ state: 'visible', timeout: 15000 });

    // const link = frame.locator(s.matchLink, { hasText: matchTitleRegex }).first();
    // await link.waitFor({ state: 'visible', timeout: 10000 });
    // await link.click({ timeout: 8000 });
    // If matchId is provided, prefer selecting by exact href
    let link;
    if (matchId) {
        link = frame.locator(`a[href="/league/contests/${matchId}/contests"]`).first();
        await link.waitFor({ state: 'visible', timeout: 10000 });
    } else {
        // fallback to match title text
        link = frame.locator(s.matchLink, { hasText: matchTitleRegex }).first();
        await link.waitFor({ state: 'visible', timeout: 10000 });
    }

    await link.click({ timeout: 8000 });

    // 6) Confirm we landed into a league/contests page (still inside the same iframe)
    // The page shows “Upcoming Matches”, “My Matches” or “Contests”; wait for any sentinel
    const sentinel = frame.locator(s.postEntrySentinel).first();
    await sentinel.waitFor({ state: 'visible', timeout: 15000 }).catch(() => { });
    return frame;
}

async function waitForFrame(page, urlRegex, timeoutMs) {
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
        // first ensure an iframe element exists in the DOM
        const frameEl = await page.locator('iframe[src*="realteam11.com"]').first();
        if (await frameEl.count() > 0) {
            // now check all frames Playwright knows about
            const frames = page.frames();
            for (const f of frames) {
                try {
                    const u = f.url();
                    if (urlRegex.test(u)) return f;
                } catch { }
            }
        }
        await sleep(500);
    }
    return null;
}