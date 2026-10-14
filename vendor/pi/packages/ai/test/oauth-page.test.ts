import { describe, expect, it } from "vitest";
import { oauthErrorHtml, oauthSuccessHtml } from "../src/utils/oauth-page.ts";

describe("OAuth result page", () => {
	it("renders the Localix brand on the success page", () => {
		const html = oauthSuccessHtml("Signed in. You may close this page.");

		expect(html).toContain('aria-label="Localix"');
		expect(html).toContain("<svg");
		expect(html).toContain('class="wind"');
		expect(html).not.toContain("<span>localix</span>");
		expect(html).not.toContain("https://localix.ai/logo.svg");
		expect(html).not.toContain("M165.29 165.29");
		expect(html).toContain("Authentication successful");
	});

	it("escapes provider-controlled messages and details", () => {
		const html = oauthErrorHtml('<script>alert("message")</script>', "token='secret'");

		expect(html).not.toContain("<script>");
		expect(html).toContain("&lt;script&gt;alert(&quot;message&quot;)&lt;/script&gt;");
		expect(html).toContain("token=&#39;secret&#39;");
	});
});
