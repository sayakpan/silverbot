import { sleep } from './util.js';

function escapeRe(s) {
    return String(s).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function normalizeText(s) {
    // replace NBSP, collapse internal whitespace, trim
    return String(s).replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
}

async function addIfNeeded(row, s) {
    const minus = row.locator(s.playerMinusButton).first(); // ".fa-minus-circle"
    if (await minus.isVisible().catch(() => false)) return true;

    const plus = row.locator(s.playerAddButton).first(); // ".fa-plus-circle"
    await plus.waitFor({ state: 'visible', timeout: 8000 });
    await plus.click().catch(() => { });
    // wait for the row to re-render to minus
    await minus.waitFor({ state: 'visible', timeout: 8000 }).catch(() => { });
    return true;
}

async function waitTabActive(frame, s, tabText) {
    const tab = frame.locator(s.teamTabs, { hasText: new RegExp(`\\b${escapeRe(tabText)}\\b`, 'i') }).first();
    await tab.click({ timeout: 8000 }).catch(() => { });
    await tab.waitFor({ state: 'visible', timeout: 10000 });
    await frame.locator(`${s.activePane} .players-list`).first().waitFor({ state: 'visible', timeout: 10000 });

    const list = frame.locator(`${s.activePane} .players-list ${s.playerListContainer}`).first();
    await list.waitFor({ state: 'visible', timeout: 10000 });
    return { list };
}

async function dumpVisibleNames(list, s, label) {
    const rows = list.locator(s.playerRow);
    const n = await rows.count();
    const out = [];
    for (let i = 0; i < n; i++) {
        const cell = rows.nth(i).locator(s.playerNameCell);
        // Only collect rows that are visible in the container viewport
        if (await rows.nth(i).isVisible().catch(() => false)) {
            const t = await cell.innerText().catch(() => '');
            out.push(t.replace(/\u00A0/g, ' ').trim());
        }
    }
    console.log(`>>> ${label}: visible=${out.length}`, out);
}

async function findRowByName(list, s, targetName) {
    const rows = list.locator(s.playerRow); // ".player-category-list"
    const count = await rows.count();
    const wanted = normalizeText(targetName).toLowerCase();

    // Pass 1: visible rows first
    for (let i = 0; i < count; i++) {
        const row = rows.nth(i);
        if (!(await row.isVisible().catch(() => false))) continue;

        const cell = row.locator(s.playerNameCell); // ".player-name"
        const raw = await cell.innerText().catch(() => '');
        const firstLine = normalizeText(raw.split('\n')[0] || '').toLowerCase();

        if (firstLine === wanted) return row;
    }

    // Pass 2: inspect all rows with scrollIntoViewIfNeeded
    for (let i = 0; i < count; i++) {
        const row = rows.nth(i);
        await row.scrollIntoViewIfNeeded().catch(() => { });

        const cell = row.locator(s.playerNameCell);
        const raw = await cell.innerText().catch(() => '');
        const firstLine = normalizeText(raw.split('\n')[0] || '').toLowerCase();

        if (firstLine === wanted) return row;
    }

    return null;
}

async function findContinueLocator(frame, s) {
    const candidates = [
        '.team-preview .btn.btn-secondary',
        '.team-preview button:has-text("Continue")',
        '.team-preview button:has-text("Contine")', // handle typo
        '.team-preview button:has-text("Next")',
        '.team-preview button:has-text("Save Team")',
        'button.btn.btn-secondary:has-text("Continue")',
        'button:has-text("Continue")',
        'button:has-text("Contine")'
    ];

    for (const sel of candidates) {
        const loc = frame.locator(sel).first();
        if (await loc.isVisible().catch(() => false)) {
            await loc.scrollIntoViewIfNeeded().catch(() => {});
            return loc;
        }
    }

    // fallback search anywhere
    const fallback = frame.locator('button', { hasText: /continue|contine|next|save/i }).first();
    if (await fallback.isVisible().catch(() => false)) {
        await fallback.scrollIntoViewIfNeeded().catch(() => {});
        return fallback;
    }

    return null;
}

async function waitForCvCScreen(frame) {
    const root = frame.locator('.select-captain-container').first();
    await root.waitFor({ state: 'visible', timeout: 15000 });
    return root;
}

async function findCvCRowByName(frame, playerName) {
    const list = frame.locator('.c-vc-player-category-list-container').first();
    await list.waitFor({ state: 'visible', timeout: 10000 });

    const rows = list.locator('.c-vc-player-category-list');
    const n = await rows.count();
    const wanted = normalizeText(playerName).toLowerCase();

    for (let i = 0; i < n; i++) {
        const row = rows.nth(i);
        const cell = row.locator('.player-name').first();
        const raw = await cell.innerText().catch(() => '');
        const firstLine = normalizeText(raw.split('\n')[0] || '').toLowerCase();
        if (firstLine === wanted) return row;
    }
    for (let i = 0; i < n; i++) {
        const row = rows.nth(i);
        await row.scrollIntoViewIfNeeded().catch(() => {});
        const cell = row.locator('.player-name').first();
        const raw = await cell.innerText().catch(() => '');
        const firstLine = normalizeText(raw.split('\n')[0] || '').toLowerCase();
        if (firstLine === wanted) return row;
    }
    return null;
}

async function clickCaptain(row) {
    const cBtn = row.locator('.c-vc-buttons .c-vc-button', { hasText: /^C$/i }).first();
    await cBtn.waitFor({ state: 'visible', timeout: 8000 });
    await cBtn.click().catch(() => {});
}

async function clickViceCaptain(row) {
    const vcBtn = row.locator('.c-vc-buttons .c-vc-button', { hasText: /^VC$/i }).first();
    await vcBtn.waitFor({ state: 'visible', timeout: 8000 });
    await vcBtn.click().catch(() => {});
}

// waits until the C/VC screen is visible and exactly one C and one VC are selected
async function waitForCvCReady(frame, { timeout = 12000 } = {}) {
    const root = frame.locator('.select-captain-container').first();
    await root.waitFor({ state: 'visible', timeout });

    const start = Date.now();
    while (Date.now() - start < timeout) {
        const selected = frame.locator('.c-vc-player-category-list .c-vc-buttons .c-vc-button.c-vc-selected');
        const count = await selected.count().catch(() => 0);
        if (count === 2) {
            const texts = [];
            for (let i = 0; i < count; i++) {
                const txt = (await selected.nth(i).innerText().catch(() => '')).trim().toUpperCase();
                texts.push(txt);
            }
            if (texts.includes('C') && texts.includes('VC')) return true;
        }
        await sleep(200);
    }
    throw new Error('C/VC not selected within timeout');
}

// visibility + enabled check for anchors/buttons
function isEnabledLocator(loc) {
    return loc.isVisible().then(async v => {
        if (!v) return false;
        const hasDisabledAttr = await loc.getAttribute('disabled').then(a => !!a).catch(() => false);
        if (hasDisabledAttr) return false;
        const cls = await loc.getAttribute('class').then(a => a || '').catch(() => '');
        if (/\bdisabled\b/i.test(cls)) return false;
        return true;
    }).catch(() => false);
}

// pick the first visible .team-preview (desktop or mobile)
async function visibleTeamPreviewBlock(frame) {
    const blocks = frame.locator('.team-preview');
    const n = await blocks.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
        const b = blocks.nth(i);
        if (await b.isVisible().catch(() => false)) return b;
    }
    return null;
}

// find a visible + enabled "Save Team" control
async function findSaveTeamLocator(frame) {
    const block = await visibleTeamPreviewBlock(frame);
    if (block) {
        const within = block.locator('a,button', { hasText: /Save Team/i }).first();
        if (await isEnabledLocator(within)) return within;
    }
    const candidates = [
        '.team-preview a.btn.btn-secondary:has-text("Save Team")',
        '.team-preview a:has-text("Save Team")',
        '.team-preview button:has-text("Save Team")',
        'a.btn.btn-secondary:has-text("Save Team")',
        'a:has-text("Save Team")'
    ];
    for (const sel of candidates) {
        const loc = frame.locator(sel).first();
        if (await isEnabledLocator(loc)) return loc;
    }
    return null;
}

// poll until Save Team becomes enabled
async function waitForSaveEnabled(frame, { timeout = 8000 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const loc = await findSaveTeamLocator(frame);
        if (loc) return loc;
        await sleep(250);
    }
    return null;
}

// resilient click (handles overlays/interception)
async function clickRobust(loc) {
    try {
        await loc.scrollIntoViewIfNeeded().catch(() => {});
        await loc.click({ timeout: 4000 });
        return true;
    } catch {
        try {
            const handle = await loc.elementHandle();
            if (!handle) return false;
            await handle.evaluate(el => {
                el.scrollIntoView({ block: 'center', inline: 'center' });
                if (el instanceof HTMLElement) el.click();
            });
            return true;
        } catch {
            return false;
        }
    }
}

// call this after you've selected C and VC
export async function saveTeam(frame) {
    await waitForCvCReady(frame, { timeout: 15000 });
    await sleep(200); // allow UI to enable the button

    const saveLoc = await waitForSaveEnabled(frame, { timeout: 10000 });
    if (!saveLoc) {
        const texts = await frame.locator('.team-preview a, .team-preview button').allInnerTexts().catch(() => []);
        console.log('team-preview controls:', texts);
        throw new Error('save_team_not_found_or_disabled');
    }

    const ok = await clickRobust(saveLoc);
    if (!ok) throw new Error('save_team_click_failed');
}

async function assignCaptainAndVC(frame, captainName, viceName) {
    if (normalizeText(captainName).toLowerCase() === normalizeText(viceName).toLowerCase()) {
        throw new Error('captain_and_vc_same');
    }

    await waitForCvCScreen(frame);

    const cRow = await findCvCRowByName(frame, captainName);
    if (!cRow) throw new Error(`captain_not_found:${captainName}`);
    await clickCaptain(cRow);

    const vcRow = await findCvCRowByName(frame, viceName);
    if (!vcRow) throw new Error(`vc_not_found:${viceName}`);
    await clickViceCaptain(vcRow);

    // const saved = await clickSaveTeam(frame);
    // if (!saved) throw new Error('save_team_not_found');
}

function normalizeNumberLike(s) {
    const t = String(s).replace(/\u00A0/g, ' ').replace(/[, ]+/g, '').trim();
    const m = t.match(/(\d+(\.\d+)?)/);
    return m ? Number(m[1]) : NaN;
}

async function clickEntryByAmount(frame, s, amount) {
    const entries = frame.locator(s.contestEntryButton);
    await entries.first().waitFor({ state: 'visible', timeout: 15000 });

    const n = await entries.count();
    let clicked = false;

    for (let i = 0; i < n; i++) {
        const btn = entries.nth(i);
        if (!(await btn.isVisible().catch(() => false))) continue;
        const raw = await btn.innerText().catch(() => '');
        const val = normalizeNumberLike(raw);
        if (!Number.isNaN(val) && val === Number(amount)) {
            await btn.scrollIntoViewIfNeeded().catch(() => {});
            await btn.click();
            clicked = true;
            break;
        }
    }

    if (!clicked) throw new Error(`entry_amount_not_found:${amount}`);

    // Decide which panel we landed on
    const existingTeamPanel = frame.locator('.selected-team-detail-wrapper').first();
    const createPane = frame.locator(`${s.activePane} .players-list`).first();

    const started = Date.now();
    while (Date.now() - started < 10000) {
        if (await existingTeamPanel.isVisible().catch(() => false)) return 'existing-team';
        if (await createPane.isVisible().catch(() => false)) return 'create-team';
        await sleep(200);
    }
    return 'unknown';
}


export async function createTeam(frame, selectors, team) {
    const s = selectors.game;

    // Click the Entry button that matches team.contestAmount
    if (!team || typeof team.contestAmount !== 'number') {
        throw new Error('contestAmount_missing');
    }
    const landing = await clickEntryByAmount(frame, s, team.contestAmount);

    // If we are on the "select existing team" screen, skip creation and return
    if (landing === 'existing-team') {
        return { frame, status: 'existing-team' };
    }

    // 2) For each category, activate tab, then add players
    for (const [cat, names] of Object.entries(team.players)) {
        const tabText = s.teamTabTextMap[cat];
        if (!tabText || !Array.isArray(names) || names.length === 0) continue;

        const { list } = await waitTabActive(frame, s, tabText);

        // Optional: debug dump
        // await dumpVisibleNames(list, s, `After activating ${tabText}`);

        for (const name of names) {
            const row = await findRowByName(list, s, name);
            if (!row) {
                console.warn(`Player not found in ${cat}: ${name}`);
                continue;
            }
            await addIfNeeded(row, s);
            // small settle time after each add
            await sleep(200);
        }
    }
    
    // Now hunt the Continue button (dynamic DOM)
    const cont = await findContinueLocator(frame, s);
    if (!cont) {
        // One more short grace period, in case DOM just injected
        await sleep(800);
        const again = await findContinueLocator(frame, s);
        if (!again) {
            // Debug: list all visible buttons
            const texts = await frame.locator(`${s.activePane} button`).allInnerTexts().catch(() => []);
            console.log('Buttons in active pane:', texts);
            throw new Error('continue_button_not_found');
        }
        await again.scrollIntoViewIfNeeded().catch(() => {});
        await again.click({ timeout: 5000 }).catch(() => {});
        return;
    }

    await cont.scrollIntoViewIfNeeded().catch(() => {});
    await cont.click({ timeout: 5000 }).catch(() => {});
    // wait for the screen to settle
    await assignCaptainAndVC(frame, team.captain, team.viceCaptain);
    // await sleep(200);
    await saveTeam(frame);
    await sleep(4000);
    return { frame, status: 'new' };
}