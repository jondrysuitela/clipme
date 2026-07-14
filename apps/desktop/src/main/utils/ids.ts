import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_abcdefghijklmnopqrstuvwxyz-";

export function createId(size = 12) {
  const bytes = randomBytes(size);
  let id = "";
  for (const byte of bytes) {
    id += ALPHABET[byte & 63];
  }
  return id;
}
