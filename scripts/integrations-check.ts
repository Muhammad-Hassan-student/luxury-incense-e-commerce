// Integrations store checks against the local database: encrypted round trip, env fallback, blank secrets keep
// their saved value, clearing, masking, tamper detection, and the test-run email kill switch.
// Saves to a scratch provider row and restores whatever was there before. Run: npm run test:integrations
import "./no-real-email";
import "dotenv/config";

export {};

const ok = (cond: boolean, msg: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) process.exitCode = 1;
};

(async () => {
  const { db } = await import("@/server/db");
  const I = await import("@/server/integrations");
  const { sendEmail, emailConfigured } = await import("@/server/email");
  const { SimpleEmail } = await import("@/emails/simple");

  // Work on the WhatsApp row (no env fallback, nothing else reads it in tests); restore it afterwards.
  const KEY = "integration:whatsapp";
  const before = await db.setting.findUnique({ where: { key: KEY } });
  try {
    await db.setting.deleteMany({ where: { key: KEY } });
    I.forgetIntegrations();
    const empty = await I.getIntegration("whatsapp");
    ok(empty.enabled === false && empty.accessToken === "" && empty.templateLanguage === "en", "nothing saved → schema defaults");

    await I.saveIntegration("whatsapp", { enabled: true, phoneNumberId: "1234567890", accessToken: "EAAG-secret-token-9876" });
    const row = await db.setting.findUniqueOrThrow({ where: { key: KEY } });
    const raw = JSON.stringify(row.value);
    ok(!raw.includes("EAAG-secret-token-9876") && !raw.includes("1234567890"), "stored row is encrypted (no plaintext in the database)");

    I.forgetIntegrations();
    const a = await I.getIntegration("whatsapp");
    ok(a.enabled && a.phoneNumberId === "1234567890" && a.accessToken === "EAAG-secret-token-9876", "round trip decrypts the saved values");

    await I.saveIntegration("whatsapp", { accessToken: "", phoneNumberId: "555" });
    I.forgetIntegrations();
    const b = await I.getIntegration("whatsapp");
    ok(b.accessToken === "EAAG-secret-token-9876" && b.phoneNumberId === "555", "a blank secret keeps the saved one; plain fields update");

    const m = await I.maskedIntegration("whatsapp");
    const tok = m.fields.find((f) => f.key === "accessToken");
    ok(tok?.value === "" && tok?.preview === "••••9876" && tok.source === "saved", "admin view masks secrets (••••9876) and never returns them");
    ok(!JSON.stringify(m).includes("EAAG-secret-token-9876"), "masked payload contains no secret anywhere");

    await I.saveIntegration("whatsapp", {}, ["accessToken"]);
    I.forgetIntegrations();
    ok((await I.getIntegration("whatsapp")).accessToken === "", "clearing removes a saved secret");

    // Tamper: flip a byte of the ciphertext → treated as nothing saved, not a crash.
    const sealed = (await db.setting.findUniqueOrThrow({ where: { key: KEY } })).value as { ct: string };
    const ct = Buffer.from(sealed.ct, "base64");
    ct[0] ^= 0xff;
    await db.setting.update({ where: { key: KEY }, data: { value: { ...sealed, ct: ct.toString("base64") } } });
    I.forgetIntegrations();
    ok((await I.getIntegration("whatsapp")).phoneNumberId === "", "a tampered row is rejected (auth tag) and ignored");

    let threw = false;
    try {
      await I.saveIntegration("email", { smtpPort: 99999 });
    } catch {
      threw = true;
    }
    ok(threw, "invalid values are refused before saving");

    // Email: with EMAIL_TRANSPORT=log nothing is sent, whatever is saved.
    ok(!(await emailConfigured()), "test runs never use a real email transport");
    const r = await sendEmail({ to: "nobody@integrations-check.invalid", subject: "x", react: SimpleEmail({ preview: "x", title: "x", body: "x" }) });
    ok(r.ok && r.via === "dev", "sendEmail logs instead of sending during tests");
  } finally {
    await db.setting.deleteMany({ where: { key: KEY } });
    if (before) await db.setting.create({ data: { key: KEY, value: before.value as object } });
    I.forgetIntegrations();
    await db.$disconnect();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
