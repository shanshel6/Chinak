
const fs = require('fs');
const content = fs.readFileSync('d:/mynewproject/src/pages/AdminDashboard.tsx', 'utf8');

let depth = 0;
let inString = false;
let stringChar = '';
let escape = false;
let inMultilineComment = false;
let inRegex = false;

const tryBlocks = [];

const lines = content.split('\n');

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  for (let j = 0; j < line.length; j++) {
    const char = line[j];
    const nextChar = line[j + 1];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\') {
      escape = true;
      continue;
    }

    if (!inString && !inRegex && char === '/' && nextChar === '*') {
      inMultilineComment = true;
      j++;
      continue;
    }
    if (inMultilineComment && char === '*' && nextChar === '/') {
      inMultilineComment = false;
      j++;
      continue;
    }
    if (inMultilineComment) continue;

    if (!inString && !inRegex && char === '/' && nextChar === '/') {
      break; 
    }

    if ((char === '"' || char === "'" || char === '`') && !inRegex) {
      if (!inString) {
        inString = true;
        stringChar = char;
      } else if (stringChar === char) {
        inString = false;
      }
      continue;
    }
    if (inString) continue;

    if (char === '/' && !inString) {
      if (inRegex) {
        inRegex = false;
      } else {
        const lastNonSpace = line.substring(0, j).trim().slice(-1);
        const regexStartChars = ['(', '=', ':', ',', '!', '&', '|', '?', '{', '}', ';', '['];
        if (regexStartChars.includes(lastNonSpace) || !lastNonSpace) {
          inRegex = true;
        }
      }
      continue;
    }
    if (inRegex) continue;

    if (char === '{') {
      depth++;
      // Check for 'try {'
      const before = line.substring(0, j).trim();
      if (before.endsWith('try')) {
        tryBlocks.push({ line: i + 1, depth: depth });
      }
    }
    if (char === '}') {
      // Check if this closes a try block
      const closingTry = tryBlocks.find(b => b.depth === depth && !b.closed);
      if (closingTry) {
        console.log(`Checking try block from line ${closingTry.line} at closing brace line ${i + 1} (depth ${depth})`);
        // Look ahead for catch or finally
        let found = false;
        // Search in current line after }
        const restOfLine = line.substring(j + 1).trim();
        if (restOfLine.startsWith('catch') || restOfLine.startsWith('finally')) {
          found = true;
        } else {
          // Search next few lines
          for (let k = i + 1; k < Math.min(i + 5, lines.length); k++) {
            if (lines[k].trim().startsWith('catch') || lines[k].trim().startsWith('finally')) {
              found = true;
              break;
            }
            if (lines[k].trim().length > 0) break; // Found something else
          }
        }
        if (!found) {
          console.log(`Potential try block without catch/finally at line ${closingTry.line}`);
        }
        closingTry.closed = true;
      }
      depth--;
    }
  }
}
