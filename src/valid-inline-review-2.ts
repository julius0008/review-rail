import { exec } from "node:child_process";

export function launchCommand(command: string) {
  return exec(command);
}

export function evaluateTemplate(input: string) {
  return eval(input);
}

export function createWeakToken() {
  return Math.random().toString(36).slice(2);
}

export function parseIncomingPayload(raw: string) {
  return JSON.parse(raw);
}
