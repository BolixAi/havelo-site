const crypto = require("node:crypto");

const RUNTIME_URL = "https://runtime.bolixgroup.se";
const STAGING_ORGANISATION = "org-havelo-staging";
const MAX_BODY_BYTES = 20_000;
const MAX_MESSAGE_CHARS = 4_000;

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
    body: JSON.stringify(body),
  };
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

function bearerToken(headers = {}) {
  const authorization = headers.authorization || headers.Authorization || "";
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  return match ? match[1] : null;
}

async function authenticatedUser(token, supabaseUrl, supabaseAnonKey) {
  const url = new URL("/auth/v1/user", supabaseUrl);
  if (url.protocol !== "https:") throw new Error("invalid_supabase_url");
  const result = await fetch(url, {
    headers: { authorization: `Bearer ${token}`, apikey: supabaseAnonKey },
    signal: AbortSignal.timeout(8_000),
  });
  if (!result.ok) return null;
  const user = await result.json();
  return typeof user?.id === "string" && /^[0-9a-f-]{36}$/i.test(user.id) ? user : null;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return response(405, { error: "method_not_allowed" });
  if (!event.body || Buffer.byteLength(event.body, "utf8") > MAX_BODY_BYTES) {
    return response(413, { error: "invalid_body" });
  }

  const token = bearerToken(event.headers);
  if (!token) return response(401, { error: "authentication_required" });

  let config;
  try {
    config = {
      supabaseUrl: requiredEnv("HAVELO_SUPABASE_URL"),
      supabaseAnonKey: requiredEnv("HAVELO_SUPABASE_ANON_KEY"),
      clientId: requiredEnv("QVANTCOM_RUNTIME_CLIENT_ID"),
      clientSecret: requiredEnv("QVANTCOM_RUNTIME_CLIENT_SECRET"),
      organisation: requiredEnv("HAVELO_STAGING_ORGANISATION_ID"),
    };
  } catch {
    return response(503, { error: "staging_not_configured" });
  }
  if (config.organisation !== STAGING_ORGANISATION) {
    return response(503, { error: "organisation_not_allowlisted" });
  }

  let input;
  try {
    input = JSON.parse(event.body);
  } catch {
    return response(400, { error: "invalid_json" });
  }
  const message = typeof input.message === "string" ? input.message.trim() : "";
  if (!message || message.length > MAX_MESSAGE_CHARS) {
    return response(400, { error: "invalid_message" });
  }

  let user;
  try {
    user = await authenticatedUser(token, config.supabaseUrl, config.supabaseAnonKey);
  } catch {
    return response(502, { error: "identity_provider_unavailable" });
  }
  if (!user) return response(401, { error: "invalid_session" });

  const conversationId =
    typeof input.conversation_id === "string" && /^[0-9a-f-]{36}$/i.test(input.conversation_id)
      ? input.conversation_id
      : crypto.randomUUID();
  const payload = {
    product: "havelo",
    profile: "havelo",
    model: "qvant-general",
    organisation_id: STAGING_ORGANISATION,
    user_id: user.id,
    permissions: ["HAVELO_USER"],
    conversation_id: conversationId,
    allowed_tools: [],
    document_sources: [],
    request: { user_message: message },
    response_contract: "qvantcom_conversation_response_v1",
  };

  let runtime;
  try {
    runtime = await fetch(`${RUNTIME_URL}/v1/conversations`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "cf-access-client-id": config.clientId,
        "cf-access-client-secret": config.clientSecret,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return response(502, { error: "runtime_unavailable" });
  }
  if (!runtime.ok) return response(502, { error: "runtime_rejected_request" });

  let result;
  try {
    result = await runtime.json();
  } catch {
    return response(502, { error: "runtime_invalid_response" });
  }
  return response(200, {
    conversation_id: conversationId,
    assistant_text: result.assistant_text,
    model: result.model,
    usage: result.usage,
  });
};

