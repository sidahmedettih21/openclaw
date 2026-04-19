# Create a plain JSON example (replace with real data later)
cat > /tmp/client_plain.json << 'EOF'
{
  "passport": "AB123456",
  "fullName": "BENALI Mohamed",
  "dateOfBirth": "1988-04-15",
  "nationality": "Algerian",
  "email": "test@example.com",
  "phone": "+213555123456",
  "appointmentType": "Schengen"
}
EOF

cd ~/visa-agent
npx tsx --eval "
import { encryptAndSave } from './src/server.ts';
import { readFileSync } from 'fs';
import os from 'os';
import path from 'path';
const data = JSON.parse(readFileSync('/tmp/client_plain.json', 'utf8'));
const out  = path.join(os.homedir(), 'visa_data', 'client.enc');
encryptAndSave(data, process.env.PASSPHRASE, out);
console.log('Encrypted to', out);
"

shred -u /tmp/client_plain.json
echo "Plaintext removed."
