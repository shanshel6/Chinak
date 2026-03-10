const fs = require('fs');
const content = fs.readFileSync(process.argv[2], 'utf8');
const lines = content.split('\n');

let tryStack = [];
for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes('try {')) {
        tryStack.push({ line: i + 1 });
    }
    if (line.includes('catch') && !line.includes('try')) {
        if (tryStack.length > 0) {
            tryStack.pop();
        } else {
            console.log(`Catch without try at line ${i + 1}`);
        }
    }
}

tryStack.forEach(s => {
    console.log(`Unclosed try starting at line ${s.line}`);
});
