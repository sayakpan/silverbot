// join-contest.js
import { sleep } from './util.js';

function parseAmount(text) {
    if (text == null) return NaN;
    const t = String(text).replace(/[,₹\s]/g, '');
    const n = Number(t);
    return Number.isFinite(n) ? n : NaN;
}

async function isEnabledLocator(loc) {
    try {
        if (!(await loc.isVisible())) return false;
        const hasDisabledAttr = !!(await loc.getAttribute('disabled'));
        if (hasDisabledAttr) return false;
        const cls = (await loc.getAttribute('class')) || '';
        if (/\bdisabled\b/i.test(cls)) return false;
        return true;
    } catch {
        return false;
    }
}

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

async function findContestEntryByAmount(frame, amount) {
    const lists = frame.locator('.contest-list');
    const count = await lists.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
        const list = lists.nth(i);
        const entryBtn = list.locator('.entry-button').first();
        if (!(await entryBtn.isVisible().catch(() => false))) continue;
        const txt = await entryBtn.innerText().catch(() => '');
        const val = parseAmount(txt);
        if (val === amount) {
            await entryBtn.scrollIntoViewIfNeeded().catch(() => {});
            return entryBtn;
        }
    }
    const anyMatch = frame.locator('.entry-button');
    const n2 = await anyMatch.count().catch(() => 0);
    for (let i = 0; i < n2; i++) {
        const b = anyMatch.nth(i);
        const txt = await b.innerText().catch(() => '');
        const val = parseAmount(txt);
        if (val === amount) {
            await b.scrollIntoViewIfNeeded().catch(() => {});
            return b;
        }
    }
    return null;
}

async function scrollUntilVisible(frame, sel, limitPx = 4000) {
    let scrolled = 0;
    while (scrolled <= limitPx) {
        const el = frame.locator(sel).first();
        if (await el.isVisible().catch(() => false)) return true;
        await frame.evaluate(() => window.scrollBy(0, 400)).catch(() => {});
        scrolled += 400;
        await sleep(120);
    }
    return false;
}

export async function waitForTeamSelectionSheet(frame, { timeout = 25000 } = {}) {
    const start = Date.now();
    // Primary sentinels: wrapper OR the radio input itself
    const WRAPPER = '.selected-team-detail-wrapper';
    const RADIO = 'input[type="radio"][name="myteam"]';

    while (Date.now() - start < timeout) {
        // Quick visibility check
        if (await frame.locator(WRAPPER).first().isVisible().catch(() => false)) return;
        if ((await frame.locator(RADIO).count().catch(() => 0)) > 0) return;

        // Try incremental scroll to bring lazy content into view
        const foundAfterScroll =
            (await scrollUntilVisible(frame, WRAPPER).catch(() => false)) ||
            (await scrollUntilVisible(frame, RADIO).catch(() => false));
        if (foundAfterScroll) return;

        // As a last small pause per loop
        await sleep(200);
    }
    throw new Error('team_selection_sheet_timeout');
}

export async function waitForContestsInSameFrame(frame, { timeout = 15000 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const hasList = await frame.locator('.contest-list').first().isVisible().catch(() => false);
        if (hasList) return;
        const hasCategory = await frame.locator('.contest-category').first().isVisible().catch(() => false);
        if (hasCategory) return;
        const stillOnCvc = await frame.locator('.select-captain-container').first().isVisible().catch(() => false);
        if (!stillOnCvc) {
            const anyButtons = await frame.locator('.entry-button').count().catch(() => 0);
            if (anyButtons > 0) return;
        }
        await sleep(250);
    }
    throw new Error('contests_not_rendered_in_frame');
}

async function selectFirstTeamRadio(frame) {
    const radios = frame.locator('input[type="radio"][name="myteam"]');
    const n = await radios.count().catch(() => 0);
    if (n === 0) throw new Error('team_radio_not_found');
    const radio = radios.first();
    try {
        await radio.scrollIntoViewIfNeeded().catch(() => {});
        await radio.click({ timeout: 4000 });
    } catch {
        const handle = await radio.elementHandle();
        if (!handle) throw new Error('team_radio_click_failed');
        await handle.evaluate(el => {
            el.scrollIntoView({ block: 'center', inline: 'center' });
            el.click();
        });
    }
}

async function findJoinButton(frame) {
    const candidates = [
        '.join-selected-team button:has-text("Join")',
        '.join-selected-team .btn:has-text("Join")',
        'button:has-text("Join")'
    ];
    for (const sel of candidates) {
        const loc = frame.locator(sel).first();
        if (await isEnabledLocator(loc)) return loc;
    }
    return null;
}

async function findVisibleModal(frame) {
    const modal = frame.locator('.modal.show[role="dialog"]').last();
    if (await modal.isVisible().catch(() => false)) return modal;
    return null;
}

async function waitForConfirmationModal(frame, { timeout = 12000 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const modal = await findVisibleModal(frame);
        if (modal) {
            const hasTitle = await modal.locator('.modal-title', { hasText: /confirmation/i }).first().isVisible().catch(() => false);
            const hasJoin = await modal.locator('button', { hasText: /join contest/i }).first().isVisible().catch(() => false);
            if (hasTitle && hasJoin) return modal;
        }
        await sleep(200);
    }
    throw new Error('confirmation_modal_timeout');
}

async function readModalJoiningAmount(modal) {
    const t1 = await modal.locator('.modal-body .row .col-4.text-right span').first().innerText().catch(() => '');
    const n1 = parseAmount(t1);
    if (Number.isFinite(n1)) return n1;

    const bodyText = await modal.locator('.modal-body').innerText().catch(() => '');
    const m = bodyText.match(/joining amount[:\s]*([₹\s\d,]+)/i);
    if (m) {
        const n2 = parseAmount(m[1]);
        if (Number.isFinite(n2)) return n2;
    }
    return NaN;
}

async function clickConfirmJoin(modal) {
    const btn = modal.locator('button', { hasText: /join contest/i }).first();
    await btn.waitFor({ state: 'visible', timeout: 8000 });
    try {
        await btn.scrollIntoViewIfNeeded().catch(() => {});
        await btn.click({ timeout: 4000 });
        return true;
    } catch {
        const handle = await btn.elementHandle();
        if (!handle) return false;
        await handle.evaluate(el => {
            el.scrollIntoView({ block: 'center', inline: 'center' });
            if (el instanceof HTMLElement) el.click();
        });
        return true;
    }
}



export async function joinContestByAmount(frame, amount, status) {
    await sleep(1000);
    if (status === 'existing-team') {
        console.log('Skipping findContestEntryByAmount: existing team selected');
    } else {
        await waitForContestsInSameFrame(frame);
        const btn = await findContestEntryByAmount(frame, amount);
        if (!btn) {
            const debug = await frame.locator('.entry-button').allInnerTexts().catch(() => []);
            console.log('entry-button texts:', debug);
            throw new Error(`contest_button_not_found_for_amount_${amount}`);
        }
        await clickRobust(btn);
    }

    await sleep(400);
    await waitForTeamSelectionSheet(frame, { timeout: 15000 });
    await sleep(400);
    await selectFirstTeamRadio(frame);

    const joinBtn = await findJoinButton(frame);
    if (!joinBtn) {
        const dbg = await frame.locator('.join-selected-team button, .join-selected-team .btn').allInnerTexts().catch(() => []);
        console.log('join-selected-team controls:', dbg);
        throw new Error('join_button_not_found_or_disabled');
    }

    const ok = await clickRobust(joinBtn);
    await sleep(3000);

    if (!ok) throw new Error('join_button_click_failed');

    const modal = await waitForConfirmationModal(frame, { timeout: 15000 });
    const seenAmt = await readModalJoiningAmount(modal);
    if (Number.isFinite(seenAmt) && seenAmt !== amount) {
        console.log(`Warning: modal amount ${seenAmt} != expected ${amount}`);
    }

    const confirmed = await clickConfirmJoin(modal);
    if (!confirmed) throw new Error('confirm_join_click_failed');

    await sleep(3000);
}