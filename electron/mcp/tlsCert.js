/**
 * tlsCert.js
 *
 * Generates and caches a self-signed TLS certificate for the MCP Dash Server.
 * Uses node-forge (already in the dependency tree) to create a cert valid for
 * 127.0.0.1 and localhost, stored in the app's userData directory.
 *
 * Usage:
 *   const { getOrCreateCert } = require('./tlsCert');
 *   const { cert, key } = getOrCreateCert(certsDir);
 *   https.createServer({ key, cert }, handler);
 */

const fs = require("fs");
const path = require("path");
const forge = require("node-forge");

/**
 * Get or create a self-signed TLS certificate for localhost.
 * @param {string} certsDir - Directory to store cert.pem and key.pem
 * @returns {{ cert: string, key: string }} PEM-encoded certificate and private key
 */
function getOrCreateCert(certsDir) {
  const certPath = path.join(certsDir, "cert.pem");
  const keyPath = path.join(certsDir, "key.pem");

  // Return existing cert if valid
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    try {
      const cert = fs.readFileSync(certPath, "utf8");
      const key = fs.readFileSync(keyPath, "utf8");
      // Verify cert is not expired
      const parsed = forge.pki.certificateFromPem(cert);
      if (parsed.validity.notAfter > new Date()) {
        return { cert, key };
      }
      console.log("[tlsCert] Existing certificate expired, regenerating...");
    } catch (e) {
      console.log("[tlsCert] Existing certificate invalid, regenerating...");
    }
  }

  console.log("[tlsCert] Generating self-signed certificate for localhost...");

  // Generate 2048-bit RSA key pair
  const keys = forge.pki.rsa.generateKeyPair(2048);

  // Create certificate
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";

  // Valid for 10 years
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(
    cert.validity.notBefore.getFullYear() + 10,
  );

  // Subject and issuer (self-signed)
  const attrs = [
    { name: "commonName", value: "Dash MCP Server" },
    { name: "organizationName", value: "Dash" },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);

  // Subject Alternative Names (SAN) — required for modern TLS clients
  cert.setExtensions([
    { name: "basicConstraints", cA: false },
    {
      name: "keyUsage",
      digitalSignature: true,
      keyEncipherment: true,
    },
    {
      name: "extKeyUsage",
      serverAuth: true,
    },
    {
      name: "subjectAltName",
      altNames: [
        { type: 7, ip: "127.0.0.1" }, // IP SAN
        { type: 2, value: "localhost" }, // DNS SAN
      ],
    },
  ]);

  // Self-sign with SHA-256
  cert.sign(keys.privateKey, forge.md.sha256.create());

  // Convert to PEM
  const certPem = forge.pki.certificateToPem(cert);
  const keyPem = forge.pki.privateKeyToPem(keys.privateKey);

  // Write to disk
  fs.mkdirSync(certsDir, { recursive: true });
  fs.writeFileSync(certPath, certPem, { mode: 0o644 });
  fs.writeFileSync(keyPath, keyPem, { mode: 0o600 });

  console.log(`[tlsCert] Certificate saved to ${certsDir}`);

  return { cert: certPem, key: keyPem };
}

module.exports = { getOrCreateCert };
