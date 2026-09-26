const fs = require('fs');
const path = require('path');
const base = '/app/node_modules/@headlessui/react/dist';

function patchFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  let t = fs.readFileSync(filePath, 'utf8');
  const pattern = /throw new Error\("[^"]*missing[^"]*show[^"]*"\)/g;
  const matches = t.match(pattern);
  if (matches && matches.length > 0) {
    t = t.replace(pattern, 'n=true');
    fs.writeFileSync(filePath, t);
    console.log(`PATCHED ${filePath} (${matches.length} replacements)`);
  }
}

// Patch all known files
function walkDir(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full);
    } else if (entry.name.endsWith('.js') && !entry.name.endsWith('.map')) {
      patchFile(full);
    }
  }
}

walkDir(base);
console.log('HeadlessUI patch complete');
