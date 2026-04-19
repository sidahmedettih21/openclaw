import { pbkdf2Sync, randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { z } from "zod";
import type { ClientData } from "./types.js";

// ── PBKDF2 parameters (OWASP 2024 — zero extra RAM) ──
const ITERATIONS = 600_000;
const KEY_LEN = 32;
const SALT_LEN = 32;
const IV_LEN = 12;
const TAG_LEN = 16;

const VERSION = Buffer.from([0x56, 0x41, 0x02, 0x00]); // PBKDF2 version

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  return pbkdf2Sync(passphrase, salt, ITERATIONS, KEY_LEN, "sha256");
}

export function encryptAndSave(data: ClientData, passphrase: string, filePath: string): void {
  const salt = randomBytes(SALT_LEN);
  const iv   = randomBytes(IV_LEN);
  const key  = deriveKey(passphrase, salt);

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plain  = Buffer.from(JSON.stringify(data), "utf8");
  const ct     = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag    = cipher.getAuthTag();

  const envelope = Buffer.concat([VERSION, salt, iv, tag, ct]);
  writeFileSync(filePath, envelope);
}

export function loadAndDecrypt(passphrase: string, filePath: string): ClientData {
  if (!existsSync(filePath)) throw new Error(`Client data not found: ${filePath}`);
  const buf = readFileSync(filePath);

  if (!timingSafeEqual(buf.subarray(0, 4), VERSION)) {
    throw new Error("Unknown envelope version — possible corruption or old scrypt file");
  }

  let offset = 4;
  const salt = buf.subarray(offset, offset += SALT_LEN);
  const iv   = buf.subarray(offset, offset += IV_LEN);
  const tag  = buf.subarray(offset, offset += TAG_LEN);
  const ct   = buf.subarray(offset);

  const key      = deriveKey(passphrase, salt);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);

  let plain: Buffer;
  try {
    plain = Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new Error("Decryption failed — wrong passphrase or tampered data");
  }

  return validateClientData(JSON.parse(plain.toString("utf8")));
}

// ── Zod schema ─────────────────────────────────────
const ClientSchema = z.object({
  passport:        z.string().regex(/^[A-Z0-9]{6,20}$/),
  fullName:        z.string().min(2).max(120),
  dateOfBirth:     z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  nationality:     z.string().min(2).max(60),
  email:           z.string().email(),
  phone:           z.string().regex(/^\+?[0-9\s\-.()]{7,25}$/),
  appointmentType: z.string().min(1),
});

export function validateClientData(raw: unknown): ClientData {
  return ClientSchema.parse(raw);
}
