const fs = require('fs');
const content = fs.readFileSync('d:\\mynewproject\\src\\pages\\AdminDashboard.tsx', 'utf8');

let depth = 0;
let inString = false;
let stringChar = '';
let stringStartLine = 0;
let inMultilineComment = false;
let inSingleLineComment = false;
let inRegex = false;
let escape = false;

const lines = content.split('\n');

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (let j = 0; j < line.length; j++) {
        const char = line[j];
        const nextChar = line[j + 1];

        if (escape) { escape = false; continue; }
        if (char === '\\') { escape = true; continue; }
        if (inMultilineComment) {
            if (char === '*' && nextChar === '/') { inMultilineComment = false; j++; }
            continue;
        }
        if (inSingleLineComment) break;
        if (inString) {
            if (char === stringChar) {
                console.log(`String closed at line ${i + 1}, char ${j + 1}: ${stringChar}`);
                inString = false;
            } else if (stringChar === '`' && char === '$' && nextChar === '{') {
                console.log(`Template literal interpolation at line ${i + 1}, char ${j + 1}`);
                // Template literals can have interpolations, but we stay in the string
            }
            continue;
        }
        if (inRegex) {
            if (char === '/') inRegex = false;
            continue;
        }
        if (char === '/' && nextChar === '*') { inMultilineComment = true; j++; continue; }
        if (char === '/' && nextChar === '/') { inSingleLineComment = true; j++; continue; }
        if (char === '/' && !' /*'.includes(nextChar)) {
            const prev = line.substring(0, j).trim();
            if (prev === '' || '=(:[!&|?,;<>+-/*%'.includes(prev[prev.length - 1])) {
                inRegex = true;
                continue;
            }
        }
        if (char === '"' || char === "'" || char === '`') {
            inString = true;
            stringChar = char;
            stringStartLine = i + 1;
            continue;
        }

        if (char === '{') depth++;
        if (char === '}') depth--;
    }
    
    // Backticks can span multiple lines. Other quotes shouldn't.
    if (inString && stringChar !== '`') {
        inString = false;
    }
    inSingleLineComment = false;
}

if (inString) {
    console.log(`Unclosed string starting at line ${stringStartLine} with char ${stringChar}`);
}
console.log(`Final Depth: ${depth}`);
