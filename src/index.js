import 'dotenv/config';
import { runAll } from './runner.js';

const onlyLogin = process.argv.includes('--only=login');

runAll({ env: process.env, onlyLogin }).catch(err => {
    console.error(err);
    process.exit(1);
});