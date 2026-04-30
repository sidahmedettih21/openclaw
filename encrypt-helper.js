const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const HOME = process.env.HOME;
const VISADATA = path.join(HOME, 'visa_data');
if (!fs.existsSync(VISADATA)) fs.mkdirSync(VISADATA, { recursive: true });

const passphrase = process.env.PASSPHRASE;
if (!passphrase) { console.error('PASSPHRASE not set'); process.exit(1); }

const raw = JSON.parse(fs.readFileSync('/tmp/placeholder.json', 'utf8'));
const salt = crypto.randomBytes(32);
const iv = crypto.randomBytes(12);
const key = crypto.scryptSync(passphrase, salt, 32);
const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
const plain = Buffer.from(JSON.stringify(raw), 'utf8');
const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
const tag = cipher.getAuthTag();
const envelope = Buffer.concat([Buffer.from([0x56,0x41,0x01,0x00]), salt, iv, tag, ct]);
fs.writeFileSync(path.join(VISADATA, 'client.enc'), envelope);
console.log('✅ client.enc created');
