import crypto from "crypto";

const ALGORITHM = "aes-256-cbc";
const ENCRYPTION_KEY =
  "v6yB8?pX!z%C*F-JaNdRgUkXp2s5v8y/B?E(G+KbPeShVmYq3t6w9z$C&F)J@NcQ";

function decrypt(text) {
  if (!text) return null;
  const textParts = text.split(":");
  const iv = Buffer.from(textParts.shift(), "hex");
  const encryptedText = Buffer.from(textParts.join(":"), "hex");
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    Buffer.from(ENCRYPTION_KEY.slice(0, 32)),
    iv,
  );
  let decrypted = decipher.update(encryptedText);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString();
}

const encryptedUri =
  "a9e1a24f5ffc572cb683bf08ee0da757:4ecf4a0474639a91f6b775ec0274cfa353dbfeec1decb7f18db1e23a1f92a2401efebe097d83ccbc48c2cb8d56d5b223517bdf970b5c4959172e2ed749cc92b61834fe9ed8518847b2b037e062af91fbd70268804ab7b1da79d7a95ed3bd5e7e0c3ca7bea57e20bfbc52c7d4a35a4440";

console.log("Decrypted URI:", decrypt(encryptedUri));
