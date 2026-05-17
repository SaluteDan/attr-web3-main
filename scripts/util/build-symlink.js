const fs = require("fs");
const path = require("path");

const projectRoot = path.join(__dirname, "..", "..");
const symlinkPath = path.join(projectRoot, "dist", "typechain-types");
const targetPath = path.join(projectRoot, "typechain-types");

// Remove existing symlink or directory
if (fs.existsSync(symlinkPath)) {
  fs.rmSync(symlinkPath, { recursive: true, force: true });
}

// Create symlink (use 'dir' for cross-platform compatibility)
fs.symlinkSync(targetPath, symlinkPath, "dir");
