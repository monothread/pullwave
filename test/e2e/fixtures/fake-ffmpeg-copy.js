#!/usr/bin/env node
// A stand-in for `ffmpeg -i a -i b -c copy out`: puts the inputs, in order, in the last argument.
const fs = require('node:fs');

const args = process.argv.slice(2);
if (args.includes('-version')) {
    process.stdout.write('ffmpeg version fake-1.0\n');
    process.exit(0);
}
const inputs = args.flatMap((argument, index) => {
    return args[index - 1] === '-i' ? [argument] : [];
});
fs.writeFileSync(
    args.at(-1),
    Buffer.concat(
        inputs.map((input) => {
            return fs.readFileSync(input);
        })
    )
);
