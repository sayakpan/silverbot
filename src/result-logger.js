// result-logger.js
import { promises as fs } from 'fs';
import path from 'path';

function csvEscape(v) {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
}

async function ensureHeader(filePath, headerCols) {
    try {
        await fs.stat(filePath);
        // exists -> do nothing
    } catch {
        const dir = path.dirname(filePath);
        await fs.mkdir(dir, { recursive: true });
        const header = headerCols.map(csvEscape).join(',') + '\n';
        await fs.writeFile(filePath, header, 'utf8');
    }
}

export async function appendResultRow(filePath, rowObj) {
    const header = [
        'timestamp',
        'match_title',
        'username',
        'status',              
        'step',              
        'duration_ms'
    ];
    await ensureHeader(filePath, header);

    const line = [
        rowObj.timestamp,
        rowObj.match_title,
        rowObj.username,
        rowObj.status,
        rowObj.step || '',
        rowObj.duration_ms ?? ''
    ].map(csvEscape).join(',') + '\n';

    // append atomically enough for our usage; concurrent appends are fine
    await fs.appendFile(filePath, line, 'utf8');
}

export async function clearFile(filePath) {
    try {
        await fs.unlink(filePath);
    } catch {}
}

export async function appendFailedCredential(filePath, cred) {
    const header = ['username', 'password'];
    await ensureHeader(filePath, header);
    const line = [cred.username || '', cred.password || ''].map(csvEscape).join(',') + '\n';
    await fs.appendFile(filePath, line, 'utf8');
}