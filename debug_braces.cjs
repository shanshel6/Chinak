const fs = require('fs');
const content = fs.readFileSync('src/pages/AdminDashboard.tsx', 'utf8');
const lines = content.split('\n');

let stack = [];
let inMultilineComment = false;
let inString = false;
let stringChar = '';
let inRegex = false;

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
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

    if (inRegex) {
      if (char === '\\') {
        j++;
        continue;
      }
      if (char === '/') {
        inRegex = false;
      }
      continue;
    }

    if (char === '/' && nextChar === '/') break;
    if (char === '/' && nextChar === '*') {
      inMultilineComment = true;
      j++;
      continue;
    }

    if (char === '/') {
      if (!inString && !inRegex && !inMultilineComment && nextChar !== '/' && nextChar !== '*') {
        const prevChars = line.substring(0, j).trim();
        const prevChar = prevChars.slice(-1);
        if (['(', '=', ',', ':', '!', '&', '|', '?', '{', '}', ';', '['].includes(prevChar) || prevChars === '') {
          inRegex = true;
          continue;
        }
      }
    }

    if (char === '"' || char === "'" || char === '`') {
      inString = true;
      stringChar = char;
      continue;
    }

    if (char === '{') {
      stack.push({ line: i + 1, char: j + 1, type: '{', lineContent: line.trim() });
    } else if (char === '}') {
      if (stack.length > 0 && stack[stack.length - 1].type === '{') {
        const opened = stack.pop();
        if (opened.line === 1037 || opened.line === 2933) {
          // console.log(`Closed brace from line ${opened.line} at line ${i + 1}`);
        }
      } else {
        console.log(`Extra '}' at line ${i + 1}, col ${j + 1}: ${line.trim()}`);
      }
    }
  }
}

console.log('--- Unclosed Braces ---');
stack.forEach(item => {
  console.log(`Unclosed '${item.type}' at line ${item.line}, col ${item.char}`);
});
console.log(`Total unclosed: ${stack.length}`);
