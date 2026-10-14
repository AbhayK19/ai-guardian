import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestMsg91Otp, verifyMsg91Otp } from "./msg91";

describe("MSG91 adapter", () => {
  beforeEach(() => {
    process.env.MSG91_AUTH_KEY = "test-server-key";
    process.env.MSG91_OTP_TEMPLATE_ID = "otp-template";
    process.env.MSG91_OTP_EXPIRY_MINUTES = "5";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("requests six-digit OTPs using provider-managed expiry and server-side auth", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({ type: "success", request_id: "provider-request-1" }),
        {
          status: 200,
        }
      )
    );
    await expect(requestMsg91Otp("919876543210")).resolves.toBe(
      "provider-request-1"
    );
    const [url, options] = vi.mocked(fetch).mock.calls[0]!;
    const parsedUrl = new URL(String(url));
    expect(parsedUrl.origin).toBe("https://control.msg91.com");
    expect(parsedUrl.pathname).toBe("/api/v5/otp");
    expect(parsedUrl.searchParams.get("otp_length")).toBe("6");
    expect(parsedUrl.searchParams.get("otp_expiry")).toBe("5");
    expect(new Headers(options?.headers).get("authkey")).toBe(
      "test-server-key"
    );
  });

  it("accepts provider verification only when the provider confirms it", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "success",
          message: "OTP verified successfully",
        }),
        {
          status: 200,
        }
      )
    );
    await expect(verifyMsg91Otp("919876543210", "123456")).resolves.toBe(true);
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBeInstanceOf(URL);
  });

  it("rejects an invalid OTP response", async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ type: "error", message: "OTP expired" }), {
        status: 200,
      })
    );
    await expect(verifyMsg91Otp("919876543210", "123456")).resolves.toBe(false);
  });

});
