import { expect, it, vi } from "vitest";
import { spawn } from "./subprocess.ts";

it("confirms process closure before notifying the native auth owner", async () => {
  let pid = 0;
  const onClose = vi.fn(() => expect(() => process.kill(pid, 0)).toThrow());
  await spawn({
    cmd: process.execPath, args: ["-e", "console.log(process.pid); setTimeout(() => process.exit(0), 30)"],
    env: { PATH: process.env.PATH ?? "" }, activityTimeout: 0,
    onStdout: (chunk) => { pid = Number(chunk.trim()); }, onClose,
  });
  expect(onClose).toHaveBeenCalledTimes(1);
});
