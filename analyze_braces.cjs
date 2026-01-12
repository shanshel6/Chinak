const fs = require('fs');
const file = process.argv[2];
const startLine = parseInt(process.argv[3]) || 1;
const endLine = parseInt(process.argv[4]) || Infinity;

const content = fs.readFileSync(file, 'utf8');
const lines = content.split('\n');

let depth = 0;
let inString = false;
let stringChar = '';
let inMultilineComment = false;
let inRegex = false;

for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;
    
    for (let j = 0; j < line.length; j++) {
        const char = line[j];
        const nextChar = line[j + 1];
        
        if (inMultilineComment) {
            if (char === '*' && nextChar === '/') {
                inMultilineComment = false;
                j++;
            }
            continue;
        }
        
        if (inString) {
            if (char === '\\') {
                j++;
                continue;
            }
            if (char === stringChar) {
                inString = false;
            }
            continue;
        }
        
        if (char === '/' && nextChar === '*') {
            inMultilineComment = true;
            j++;
            continue;
        }
        
        if (char === '/' && nextChar === '/') {
            break;
        }
        
        if (char === "'" || char === '"' || char === '`') {
            inString = true;
            stringChar = char;
            continue;
        }
        
        if (char === '{') {
            depth++;
        } else if (char === '}') {
            depth--;
        }
    }
    
    if (lineNum >= startLine && lineNum <= endLine) {
        console.log(`Line ${lineNum}: Depth ${depth} | ${line.trim().substring(0, 50)}`);
    }
}
