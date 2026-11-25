// Resolves a variant name to the text of the script under test.
//   current        ../XSearchAndUpload.user.js (the default everywhere)
//   <name>         ./<name>.user.js, a copy you put next to this file, e.g.
//                  git show main:XSearchAndUpload/XSearchAndUpload.user.js > test/base.user.js
//   <name>_probe   the same, with imageRefs exposed as window.__imageRefs (in memory only)
const fs = require('fs');
const path = require('path');

function readScript(variant) {
  const probe = variant.endsWith('_probe');
  const name = probe ? variant.slice(0, -'_probe'.length) : variant;
  const file = name === 'current'
    ? path.join(__dirname, '..', 'XSearchAndUpload.user.js')
    : path.join(__dirname, name + '.user.js');
  const src = fs.readFileSync(file, 'utf8');
  if (!probe) {
    return src;
  }
  const out = src.replace('const imageRefs = [];', 'const imageRefs = window.__imageRefs = [];');
  if (out === src) {
    throw new Error('imageRefs declaration not found in ' + file);
  }
  return out;
}

module.exports = {readScript};
