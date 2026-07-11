import crypto from "crypto";
import { logger } from "../utils/logger.js";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "SiteMonitorSecretKey2026Secure32";
const ALGORITHM = "aes-256-cbc";

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  return iv.toString("hex") + ":" + encrypted.toString("hex");
}

export const encryptionMiddleware = (req, res, next) => {
  const originalJson = res.json;
  
  res.json = function (body) {
    try {
      // Avoid encrypting twice if somehow called again
      if (body && body.encryptedData) {
        return originalJson.call(this, body);
      }
      
      const jsonString = JSON.stringify(body);
      const encryptedData = encrypt(jsonString);
      return originalJson.call(this, { encryptedData });
    } catch (error) {
      logger.error("Encryption error:", error);
      return originalJson.call(this, body);
    }
  };
  
  next();
};
