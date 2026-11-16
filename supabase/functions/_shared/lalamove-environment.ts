export type LalamoveEnvironment = "sandbox" | "producao";
export type LalamoveCredentials = { apiKey: string; apiSecret: string; baseUrl: string };

export function normalizeLalamoveEnvironment(value: unknown): LalamoveEnvironment {
  if (value === "sandbox" || value === "producao") return value;
  throw new Error("INVALID_LALAMOVE_ENVIRONMENT");
}

export function lalamoveBaseUrl(environment: LalamoveEnvironment): string {
  return environment === "producao"
    ? "https://rest.lalamove.com"
    : "https://rest.sandbox.lalamove.com";
}

export function lalamoveCredentialNames(environment: LalamoveEnvironment) {
  return environment === "producao"
    ? { key: "LALAMOVE_PROD_API_KEY", secret: "LALAMOVE_PROD_API_SECRET" }
    : { key: "LALAMOVE_SANDBOX_API_KEY", secret: "LALAMOVE_SANDBOX_API_SECRET" };
}

export function readLalamoveCredentials(
  environment: LalamoveEnvironment,
  readEnv: (name: string) => string | undefined,
): LalamoveCredentials {
  const names = lalamoveCredentialNames(environment);
  const apiKey = readEnv(names.key) || "";
  const apiSecret = readEnv(names.secret) || "";
  const prefix = environment === "producao" ? "pk_prod" : "pk_test";
  const secretPrefix = environment === "producao" ? "sk_prod" : "sk_test";
  if (!apiKey.startsWith(prefix) || !apiSecret.startsWith(secretPrefix)) {
    throw new Error(environment === "producao"
      ? "PRODUCTION_CREDENTIALS_REQUIRED"
      : "SANDBOX_CREDENTIALS_REQUIRED");
  }
  return { apiKey, apiSecret, baseUrl: lalamoveBaseUrl(environment) };
}

export async function readLalamoveEnvironment(db: {
  from: (table: string) => any;
}): Promise<LalamoveEnvironment> {
  const { data, error } = await db.from("delivery_settings")
    .select("lalamove_ambiente").eq("singleton", true).maybeSingle();
  if (error || !data) throw new Error("LALAMOVE_ENVIRONMENT_UNAVAILABLE");
  return normalizeLalamoveEnvironment(data.lalamove_ambiente);
}
