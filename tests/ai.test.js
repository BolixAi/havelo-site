const assert = require("node:assert/strict");
const test = require("node:test");

const ORIGINAL_ENV = { ...process.env };
const USER_ID = "11111111-1111-4111-8111-111111111111";

function configured() {
  process.env.HAVELO_SUPABASE_URL = "https://example.supabase.co";
  process.env.HAVELO_SUPABASE_ANON_KEY = "public-anon-key";
  process.env.QVANTCOM_RUNTIME_CLIENT_ID = "havelo.access";
  process.env.QVANTCOM_RUNTIME_CLIENT_SECRET = "secret";
  process.env.HAVELO_STAGING_ORGANISATION_ID = "org-havelo-staging";
}

function request(body, authorization = "Bearer user-jwt") {
  return { httpMethod: "POST", headers: { authorization }, body: JSON.stringify(body) };
}

test.afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete global.fetch;
});

test("rejects missing authentication before external calls", async () => {
  configured();
  const { handler } = require("../netlify/functions/ai");
  const result = await handler(request({ message: "Hej" }, ""));
  assert.equal(result.statusCode, 401);
});

test("fails closed for any other organisation", async () => {
  configured();
  process.env.HAVELO_STAGING_ORGANISATION_ID = "org-other";
  const { handler } = require("../netlify/functions/ai");
  const result = await handler(request({ message: "Hej" }));
  assert.equal(result.statusCode, 503);
  assert.equal(JSON.parse(result.body).error, "organisation_not_allowlisted");
});

test("derives user identity server-side and sends a fixed Havelo scope", async () => {
  configured();
  const calls = [];
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("supabase.co")) {
      return { ok: true, json: async () => ({ id: USER_ID, email: "pilot@example.se" }) };
    }
    return {
      ok: true,
      json: async () => ({ assistant_text: "Svar", model: "qvant-general", usage: {} }),
    };
  };
  const { handler } = require("../netlify/functions/ai");
  const result = await handler(
    request({
      message: "Hitta en båt",
      product: "chatlaw",
      organisation_id: "org-chatlaw-staging",
      allowed_tools: ["chatlaw_legal_engine"],
    }),
  );
  assert.equal(result.statusCode, 200);
  const runtimeBody = JSON.parse(calls[1].options.body);
  assert.equal(runtimeBody.product, "havelo");
  assert.equal(runtimeBody.profile, "havelo");
  assert.equal(runtimeBody.organisation_id, "org-havelo-staging");
  assert.equal(runtimeBody.user_id, USER_ID);
  assert.deepEqual(runtimeBody.allowed_tools, []);
  assert.deepEqual(runtimeBody.document_sources, []);
  assert.equal(calls[1].options.headers["cf-access-client-secret"], "secret");
});

test("does not return runtime credentials to the browser", async () => {
  configured();
  global.fetch = async (url) =>
    String(url).includes("supabase.co")
      ? { ok: true, json: async () => ({ id: USER_ID }) }
      : { ok: true, json: async () => ({ assistant_text: "Svar", model: "qvant-general", usage: {} }) };
  const { handler } = require("../netlify/functions/ai");
  const result = await handler(request({ message: "Hej" }));
  assert.equal(result.statusCode, 200);
  assert.doesNotMatch(result.body, /secret|client-id|access-client/i);
});
