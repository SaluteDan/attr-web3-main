#!/usr/bin/env node

const { spawn } = require("child_process");
const { promises: fs } = require("fs");
const os = require("os");
const path = require("path");

require("dotenv").config();

const VERIFY_TIMEOUT_MS = 120000;
const packageRoot = path.resolve(__dirname, "..");

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
    });
    process.stdin.on("end", () => resolve(input));
    process.stdin.on("error", reject);
  });
}

function serializeArgsModule(args) {
  return `module.exports = ${JSON.stringify(args, null, 2)};\n`;
}

async function writeTempArgsFile(args) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "attr-verify-"));
  const file = path.join(dir, "args.cjs");
  await fs.writeFile(file, serializeArgsModule(args), "utf8");
  return { file, dir };
}

async function cleanup(dir) {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

function runHardhatVerify(input, argsFile) {
  return new Promise((resolve) => {
    const argv = [
      "hardhat",
      "verify",
      "--network",
      input.network,
      "--constructor-args",
      argsFile,
      "--contract",
      input.contract,
      input.address,
    ];

    const proc = spawn("npx", argv, {
      cwd: packageRoot,
      env: process.env,
      shell: false,
    });

    const timeout = setTimeout(() => {
      proc.kill("SIGTERM");
    }, VERIFY_TIMEOUT_MS);

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d) => {
      stderr += d.toString();
    });
    proc.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ code, stdout, stderr });
    });
    proc.on("error", (err) => {
      clearTimeout(timeout);
      resolve({ code: -1, stdout, stderr: String(err) });
    });
  });
}

function isAlreadyVerified(output) {
  return /already verified|smart-contract already verified/i.test(output);
}

async function main() {
  const raw = await readStdin();
  const input = JSON.parse(raw);

  let dir;
  try {
    const temp = await writeTempArgsFile(input.constructorArgs || []);
    dir = temp.dir;

    const { code, stdout, stderr } = await runHardhatVerify(input, temp.file);
    const output = `${stdout}\n${stderr}`.trim();
    const alreadyVerified = isAlreadyVerified(output);
    const success = code === 0 || alreadyVerified;

    process.stdout.write(
      JSON.stringify({
        success,
        alreadyVerified,
        code,
        stdout,
        stderr,
        output,
      }),
    );
    process.exit(success ? 0 : 1);
  } finally {
    if (dir) await cleanup(dir);
  }
}

main().catch((err) => {
  process.stdout.write(
    JSON.stringify({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }),
  );
  process.exit(1);
});
