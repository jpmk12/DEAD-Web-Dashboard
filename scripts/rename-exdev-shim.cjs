// fs.rename EXDEV fallback shim — preloaded into `next build` via
// NODE_OPTIONS=--require (see build.js / start.js).
//
// The hosting sandbox's filesystem returns EXDEV ("cross-device link not
// permitted") for rename() across directories — e.g. Next's static-export step
// moving `.next/export/500.html` -> `.next/server/pages/500.html`. That aborts
// the build. rename() can't cross devices, so we fall back to copy-then-remove,
// which works regardless of how the sandbox layers its mounts.
//
// Patches the sync, callback, and promise forms. Loaded before any other module
// (preload), so even destructured references (`const { rename } = require(...)`)
// and graceful-fs pick up the patched versions.
const fs = require("fs");
const fsp = fs.promises;

function fallbackCopy(src, dest) {
  fs.cpSync(src, dest, { recursive: true, force: true });
  fs.rmSync(src, { recursive: true, force: true });
}

const origRenameSync = fs.renameSync.bind(fs);
fs.renameSync = function (src, dest) {
  try {
    return origRenameSync(src, dest);
  } catch (err) {
    if (err && err.code === "EXDEV") return fallbackCopy(src, dest);
    throw err;
  }
};

const origRename = fs.rename.bind(fs);
fs.rename = function (src, dest, cb) {
  origRename(src, dest, (err) => {
    if (err && err.code === "EXDEV") {
      try {
        fallbackCopy(src, dest);
        cb(null);
      } catch (e) {
        cb(e);
      }
      return;
    }
    cb(err);
  });
};

const origRenameP = fsp.rename.bind(fsp);
fsp.rename = async function (src, dest) {
  try {
    return await origRenameP(src, dest);
  } catch (err) {
    if (err && err.code === "EXDEV") {
      await fsp.cp(src, dest, { recursive: true, force: true });
      await fsp.rm(src, { recursive: true, force: true });
      return;
    }
    throw err;
  }
};
