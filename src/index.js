import 'dotenv/config';
import { runAll } from './runner.js';

const onlyLogin = process.argv.includes('--only=login');
const fromFailed = process.argv.includes('--from=failed');


runAll({ env: process.env, onlyLogin, fromFailed }).catch(err => {
    console.error(err);
    process.exit(1);
});