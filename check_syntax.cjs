const fs = require('fs');
const content = fs.readFileSync('server/index.js', 'utf8');

let depth = 0;
let parenDepth = 0;
let bracketDepth = 0;
let inString = false;
let stringChar = '';
let inComment = false;
let inMultilineComment = false;
let inRegex = false;
let line = 1;

for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i + 1];

    if (char === '\n') {
        line++;
        if (line % 100 === 0) {
            console.log(`Line ${line}: {${depth}, (${parenDepth}, [${bracketDepth}`);
        }
    }

    if (inMultilineComment) {
        if (char === '*' && nextChar === '/') {
            inMultilineComment = false;
            i++;
        }
        continue;
    }

    if (inComment) {
        if (char === '\n') {
            inComment = false;
        }
        continue;
    }

    if (inString) {
        if (char === '\\') {
            i++;
            continue;
        }
        if (char === stringChar) {
            inString = false;
        }
        continue;
    }

    if (inRegex) {
        if (char === '\\') {
            i++;
            continue;
        }
        if (char === '/') {
            inRegex = false;
        }
        continue;
    }

    if (char === '/' && nextChar === '*') {
        inMultilineComment = true;
        i++;
        continue;
    }

    if (char === '/' && nextChar === '/') {
        inComment = true;
        i++;
        continue;
    }

    if (char === '/') {
        const prev = content.substring(Math.max(0, i - 20), i).trim();
        const prevChar = prev[prev.length - 1];
        if (['=', '(', '[', ',', ':', '!', '&', '|', '?', '{', '}'].includes(prevChar) || prev.endsWith('return')) {
            inRegex = true;
            continue;
        }
    }

    if (char === "'" || char === '"' || char === '`') {
        inString = true;
        stringChar = char;
        continue;
    }

    if (char === '{') depth++;
    if (char === '}') depth--;
    if (char === '(') parenDepth++;
    if (char === ')') parenDepth--;
    if (char === '[') bracketDepth++;
    if (char === ']') bracketDepth--;

    if (depth < 0 || parenDepth < 0 || bracketDepth < 0) {
        console.log(`Negative depth at line ${line}: {${depth}, (${parenDepth}, [${bracketDepth}`);
        if (depth < 0) depth = 0;
        if (parenDepth < 0) parenDepth = 0;
        if (bracketDepth < 0) bracketDepth = 0;
    }
}

console.log(`Final state: {${depth}, (${parenDepth}, [${bracketDepth}`);
if (inString) console.log('Unclosed string');
if (inRegex) console.log('Unclosed regex');
if (inMultilineComment) console.log('Unclosed multiline comment');
