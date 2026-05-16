import { spawn } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import * as dotenv from "dotenv";

dotenv.config();

interface VerifyContractInput {
  address: string;
  network: string;
  contract: string;
  constructorArgs: unknown[];
}

interface SpawnResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

const VERIFY_TIMEOUT_MS = 120_000;

function readStdin(): Promise<string> {
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

function serializeArgsModule(args: unknown[]): string {
  return `module.exports = ${JSON.stringify(args, null, 2)};\n`;
}

async function writeTempArgsFile(
  args: unknown[],
): Promise<{ file: string; dir: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "attr-verify-"));
  const file = path.join(dir, "args.cjs");
  await fs.writeFile(file, serializeArgsModule(args), "utf8");
  return { file, dir };
}

async function cleanup(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

function runHardhatVerify(
  input: VerifyContractInput,
  argsFile: string,
): Promise<SpawnResult> {
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
      cwd: process.cwd(),
      env: process.env,
      shell: false,
    });

    const timeout = setTimeout(() => {
      proc.kill("SIGTERM");
    }, VERIFY_TIMEOUT_MS);

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
    });
    proc.stderr.on("data", (d: Buffer) => {
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

function isAlreadyVerified(output: string): boolean {
  return /already verified|smart-contract already verified/i.test(output);
}

async function main(): Promise<void> {
  const raw = await readStdin();
  const input = JSON.parse(raw) as VerifyContractInput;

  let dir: string | undefined;
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
