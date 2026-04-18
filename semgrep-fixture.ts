import { exec } from "node:child_process";

export function runUserCommand(cmd: string) {
  return exec(cmd);
}

export function unsafeTemplate(userInput: string) {
  return eval(userInput);
}

export function issueTokenSuffix() {
  return Math.random().toString(36).slice(2);
}

export function parseRawInput(raw: string) {
  return JSON.parse(raw);
}