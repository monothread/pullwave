#!/usr/bin/env node
const fs = require('node:fs');

Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);

const args = process.argv.slice(2);
const listPath = args[args.indexOf('-i') + 1];
const outputPath = args.at(-1);
const files = fs
    .readFileSync(listPath, 'utf-8')
    .split('\n')
    .map((line) => {
        return line.replace(/^file '/, '').replace(/'$/, '').replaceAll("'\\''", "'");
    });
fs.writeFileSync(
    outputPath,
    Buffer.concat(
        files.map((file) => {
            return fs.readFileSync(file);
        })
    )
);
