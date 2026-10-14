const MSG91_API = "https://control.msg91.com/api/v5";

type Msg91Response = {
  type?: string;
  message?: string;
  request_id?: string;
  [key: string]: unknown;
};

function authKey() {
  const key = process.env.MSG91_AUTH_KEY?.trim();
  if (!key) throw new Error("MSG91_AUTH_KEY is not configured");
  return key;
}

function otpTemplateId() {
  const templateId = process.env.MSG91_OTP_TEMPLATE_ID?.trim();
  if (!templateId) throw new Error("MSG91_OTP_TEMPLATE_ID is not configured");
  return templateId;
}

export function getMsg91OtpExpiryMinutes() {
  const value = Number(process.env.MSG91_OTP_EXPIRY_MINUTES || 5);
  return Number.isInteger(value) && value >= 2 && value <= 10 ? value : 5;
}

async function parseResponse(response: Response): Promise<Msg91Response> {
  try {
    return (await response.json()) as Msg91Response;
  } catch {
    return {};
  }
}

function accepted(response: Response, body: Msg91Response) {
  return response.ok && body.type?.toLowerCase() === "success";
}

export async function requestMsg91Otp(mobile: string): Promise<string | null> {
  const url = new URL(`${MSG91_API}/otp`);
  url.searchParams.set("template_id", otpTemplateId());
  url.searchParams.set("mobile", mobile);
  url.searchParams.set("otp_length", "6");
  url.searchParams.set("otp_expiry", String(getMsg91OtpExpiryMinutes()));

  const response = await fetch(url, {
    method: "POST",
    headers: {
      authkey: authKey(),
      "content-type": "application/json",
    },
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(10_000),
  });
  const body = await parseResponse(response);
  if (!accepted(response, body)) {
    throw new Error(`MSG91 rejected OTP send (HTTP ${response.status})`);
  }
  return typeof body.request_id === "string" ? body.request_id : null;
}

export async function verifyMsg91Otp(
  mobile: string,
  otp: string
): Promise<boolean> {
  const url = new URL(`${MSG91_API}/otp/verify`);
  url.searchParams.set("mobile", mobile);
  url.searchParams.set("otp", otp);

  const response = await fetch(url, {
    method: "GET",
    headers: { authkey: authKey() },
    signal: AbortSignal.timeout(10_000),
  });
  const body = await parseResponse(response);
  return (
    response.ok &&
    body.type?.toLowerCase() === "success" &&
    body.message?.toLowerCase().includes("verified") === true
  );
}
