const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..", "..");
const symlinkPath = path.join(projectRoot, "dist", "typechain-types");
const targetPath = path.join(projectRoot, "typechain-types");

// Remove existing symlink or directory
if (fs.existsSync(symlinkPath)) {
  fs.rmSync(symlinkPath, { recursive: true, force: true });
}

// Use a relative path so the symlink works both locally and in the published npm package
const relativeTarget = path.relative(path.dirname(symlinkPath), targetPath);
fs.symlinkSync(relativeTarget, symlinkPath, "dir");
