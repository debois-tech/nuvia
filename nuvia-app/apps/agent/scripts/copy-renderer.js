const { cpSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
mkdirSync(join(__dirname, '..', 'dist', 'renderer'), { recursive: true });
cpSync(join(__dirname, '..', 'src', 'renderer'), join(__dirname, '..', 'dist', 'renderer'), { recursive: true });
