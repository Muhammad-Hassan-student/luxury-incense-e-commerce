// Import FIRST (before "dotenv/config" or any app module) in check scripts: emails then go to the console.
// Empty strings, not `delete`: dotenv never overrides a variable that is already set, and the app treats "" as unset.
process.env.RESEND_API_KEY = "";
process.env.SMTP_USER = "";
process.env.SMTP_PASSWORD = "";

export {};
