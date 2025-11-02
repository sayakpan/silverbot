import fs from 'fs';
import path from 'path';
import { parse } from 'csv-parse/sync';

export const sleep = (ms) => new Promise(r => setTimeout(r, ms));
export const jitter = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;

export function readJSON(p) {
    return JSON.parse(fs.readFileSync(path.resolve(p), 'utf-8'));
}

export function readCSV(p) {
    const raw = fs.readFileSync(path.resolve(p), 'utf-8');
    return parse(raw, { columns: true, skip_empty_lines: true })
        .map(r => ({ username: String(r.username || '').trim(), password: String(r.password || '').trim() }));
}

export function tpl(format, rawValue) {
    const value = String(rawValue).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    return format.replace('%s', value);
}
