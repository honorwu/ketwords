const fs = require("node:fs");
const crypto = require("node:crypto");

const SESSION_COOKIE = "ket_session";
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function randomSecret(size = 18) {
  return crypto.randomBytes(size).toString("base64url");
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));

  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function hashPassword(password) {
  const salt = randomSecret(16);
  const hash = crypto
    .scryptSync(String(password), salt, 32, {
      N: 16384,
      r: 8,
      p: 1,
    })
    .toString("base64url");

  return `scrypt$16384$8$1$${salt}$${hash}`;
}

function verifyPasswordHash(password, encodedHash) {
  const [algorithm, nValue, rValue, pValue, salt, storedHash] = String(encodedHash || "").split("$");

  if (algorithm !== "scrypt" || !salt || !storedHash) {
    return false;
  }

  let candidateHash;

  try {
    candidateHash = crypto
      .scryptSync(String(password), salt, 32, {
        N: Number(nValue),
        r: Number(rValue),
        p: Number(pValue),
      })
      .toString("base64url");
  } catch (error) {
    return false;
  }

  return safeEqual(candidateHash, storedHash);
}

function parseCookies(cookieHeader = "") {
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separatorIndex = part.indexOf("=");
        const key = separatorIndex >= 0 ? part.slice(0, separatorIndex) : part;
        const value = separatorIndex >= 0 ? part.slice(separatorIndex + 1) : "";
        return [key, decodeURIComponent(value)];
      })
  );
}

function loadAuthConfig(dataDir, authConfigPath) {
  fs.mkdirSync(dataDir, { recursive: true });

  let fileConfig = {};

  if (fs.existsSync(authConfigPath)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(authConfigPath, "utf8"));
    } catch (error) {
      console.warn("认证配置读取失败，将重新生成缺失项。", error);
    }
  }

  const studyPassword =
    process.env.KET_STUDY_PASSWORD || process.env.STUDY_PASSWORD || fileConfig.studyPassword;
  const adminPassword =
    process.env.KET_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || fileConfig.adminPassword;
  const nextConfig = {
    studyPasswordHash: process.env.KET_STUDY_PASSWORD_HASH || fileConfig.studyPasswordHash,
    adminPasswordHash: process.env.KET_ADMIN_PASSWORD_HASH || fileConfig.adminPasswordHash,
    sessionSecret:
      process.env.KET_SESSION_SECRET || process.env.SESSION_SECRET || fileConfig.sessionSecret,
  };

  let generated = false;

  if (studyPassword) {
    nextConfig.studyPasswordHash = hashPassword(studyPassword);
    generated = true;
  }

  if (adminPassword) {
    nextConfig.adminPasswordHash = hashPassword(adminPassword);
    generated = true;
  }

  if (!nextConfig.studyPasswordHash) {
    nextConfig.studyPasswordHash = hashPassword(randomSecret());
    generated = true;
  }

  if (!nextConfig.adminPasswordHash) {
    nextConfig.adminPasswordHash = hashPassword(randomSecret());
    generated = true;
  }

  if (!nextConfig.sessionSecret) {
    nextConfig.sessionSecret = randomSecret(32);
    generated = true;
  }

  if (generated || !fs.existsSync(authConfigPath) || fileConfig.studyPassword || fileConfig.adminPassword) {
    fs.writeFileSync(authConfigPath, JSON.stringify(nextConfig, null, 2), {
      encoding: "utf8",
      mode: 0o600,
    });
    console.log(`已生成认证配置：${authConfigPath}`);
  }

  return nextConfig;
}

function createAuth({ dataDir, authConfigPath }) {
  const authConfig = loadAuthConfig(dataDir, authConfigPath);

  function signSessionBody(body) {
    return crypto
      .createHmac("sha256", authConfig.sessionSecret)
      .update(body)
      .digest("base64url");
  }

  function createSessionToken(role) {
    const body = Buffer.from(
      JSON.stringify({
        role,
        exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
      })
    ).toString("base64url");

    return `${body}.${signSessionBody(body)}`;
  }

  function readSession(request) {
    const token = parseCookies(request.headers.cookie || "")[SESSION_COOKIE];

    if (!token) {
      return null;
    }

    const [body, signature] = token.split(".");

    if (!body || !signature || !safeEqual(signature, signSessionBody(body))) {
      return null;
    }

    try {
      const session = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));

      if (!session.exp || session.exp < Date.now()) {
        return null;
      }

      if (session.role !== "study" && session.role !== "admin") {
        return null;
      }

      return session;
    } catch (error) {
      return null;
    }
  }

  function buildSessionCookie(request, token) {
    const isSecure =
      process.env.KET_COOKIE_SECURE === "1" ||
      request.headers["x-forwarded-proto"] === "https";

    return [
      `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
      isSecure ? "Secure" : "",
    ]
      .filter(Boolean)
      .join("; ");
  }

  function buildClearCookie() {
    return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }

  function canAccess(session, role) {
    if (!session) {
      return false;
    }

    return role === "study"
      ? session.role === "study" || session.role === "admin"
      : session.role === "admin";
  }

  function verifyPassword(role, password) {
    if (role === "admin") {
      return verifyPasswordHash(password, authConfig.adminPasswordHash) ? "admin" : null;
    }

    if (verifyPasswordHash(password, authConfig.studyPasswordHash)) {
      return "study";
    }

    if (verifyPasswordHash(password, authConfig.adminPasswordHash)) {
      return "admin";
    }

    return null;
  }

  return {
    buildClearCookie,
    buildSessionCookie,
    canAccess,
    createSessionToken,
    readSession,
    verifyPassword,
  };
}

module.exports = {
  createAuth,
};
