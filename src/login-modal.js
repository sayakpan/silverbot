import { sleep } from './util.js';

function ensureString(name, v) {
    if (typeof v !== 'string' || !v.trim()) {
        throw new Error(`selector "${name}" is missing or not a non-empty string`);
    }
}

function ensureArray(name, v) {
    if (!Array.isArray(v) || v.length === 0) {
        throw new Error(`selector list "${name}" is missing or empty`);
    }
}

async function forceShowLoginModal(page) {
    await page.evaluate(() => {
        const modalRoot = document.querySelector('#login');
        if (!modalRoot) return false;
        modalRoot.style.display = 'block';
        modalRoot.classList.add('show');
        modalRoot.setAttribute('aria-modal', 'true');
        modalRoot.removeAttribute('aria-hidden');
        return true;
    });
}

export async function loginWithModal(page, baseUrl, selectors, username, password) {
    if (!page) throw new Error('page not provided');
    ensureString('baseUrl', baseUrl);

    const s = selectors?.login;
    if (!s) throw new Error('selectors.login is missing');

    ensureArray('login.triggers', s.triggers);
    ensureString('login.modalRoot', s.modalRoot);
    ensureString('login.form', s.form);
    ensureString('login.username', s.username);
    ensureString('login.password', s.password);
    ensureString('login.submitWithinForm', s.submitWithinForm);
    ensureString('login.errorText', s.errorText);
    ensureString('login.postLoginSentinel', s.postLoginSentinel);

    await page.goto(baseUrl, { waitUntil: 'load' });
    await sleep(500);
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => { });

    let modal = page.locator(s.modalRoot).first();
    let modalVisible = await modal.isVisible().catch(() => false);

    if (!modalVisible) {
        for (const t of s.triggers) {
            const cand = page.locator(t).first();
            if (await cand.isVisible().catch(() => false)) {
                await cand.click({ timeout: 5000 }).catch(() => { });
                await sleep(300);
                modalVisible = await modal.isVisible().catch(() => false);
                if (modalVisible) break;
            }
        }
    }

    if (!modalVisible) {
        await forceShowLoginModal(page);
        await sleep(250);
        modalVisible = await modal.isVisible().catch(() => false);
    }

    if (!modalVisible) throw new Error('login_modal_not_visible');

    const form = modal.locator(s.form).first();
    await form.waitFor({ state: 'visible', timeout: 15000 });

    const userInput = form.locator(s.username).first();
    const passInput = form.locator(s.password).first();

    await userInput.waitFor({ state: 'visible', timeout: 15000 });
    await passInput.waitFor({ state: 'visible', timeout: 15000 });

    await userInput.fill(username, { timeout: 15000 });
    await passInput.fill(password, { timeout: 15000 });

    // Fire input/change for frameworks that rely on them to enable the submit button
    await page.evaluate(() => {
        const dispatch = (el) => {
            el && el.dispatchEvent(new Event('input', { bubbles: true }));
            el && el.dispatchEvent(new Event('change', { bubbles: true }));
            el && el.dispatchEvent(new Event('blur', { bubbles: true }));
        };
        const formEl = document.querySelector('#login .login-form') || document.querySelector('.login-form');
        if (!formEl) return;
        const u = formEl.querySelector("input[placeholder='Enter Username']");
        const p = formEl.querySelector("input[placeholder='Enter Password']");
        dispatch(u);
        dispatch(p);
    });

    const age = form.locator('#customCheck').first();
    if (await age.isVisible().catch(() => false)) {
        await age.check().catch(() => { });
    }

    // Wait for submit button inside THIS form (scoped with :scope)
    const submitBtn = form.locator(s.submitWithinForm).first();

    // Try to wait until it becomes enabled
    const t0 = Date.now();
    let enabled = false;
    while (Date.now() - t0 < 6000) {
        const attached = await submitBtn.isVisible().catch(() => false);
        if (attached) {
            const disabled = await submitBtn.isDisabled().catch(() => false);
            if (!disabled) { enabled = true; break; }
        }
        // tap focus changes to trigger validations
        await passInput.focus().catch(() => { });
        await passInput.press('Tab').catch(() => { });
        await sleep(150);
    }

    if (enabled) {
        await submitBtn.click({ timeout: 8000 }).catch(() => { });
    } else {
        // Last resort: submit the form programmatically so onsubmit handlers still run
        await page.evaluate(() => {
            const formEl = document.querySelector('#login .login-form') || document.querySelector('.login-form');
            if (formEl) {
                if (typeof formEl.requestSubmit === 'function') formEl.requestSubmit();
                else formEl.submit();
            }
        });
    }

    // Success signal: modal hides or a logged-in sentinel appears
    await Promise.race([
        modal.waitFor({ state: 'hidden', timeout: 8000 }).catch(() => { }),
        page.locator(s.postLoginSentinel).first().waitFor({ state: 'visible', timeout: 8000 }).catch(() => { })
    ]);
    await sleep(5000);
    for (let i = 0; i < 3; i++) {
        await page.keyboard.press('Escape').catch(() => { });
        await sleep(400);
    }

    const errorVisible = await page.locator(s.errorText).first().isVisible().catch(() => false);
    if (errorVisible) throw new Error('login_failed');
}