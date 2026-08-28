# Amie base email template

Load `amie-base-email.html` as the body of a new code-based email template in Amie Send. Keep the document as raw HTML (do not convert it to MJML), then set the template subject, sender, and subscription group in the editor.

Before publishing:

- Replace the sample headline, copy, and link labels.
- Populate the `primaryCtaUrl` and `secondaryCtaUrl` user properties used by the sample Liquid expressions, or replace those expressions with final URLs.
- Replace the `physicalAddress` sample expression with the sender's legal physical mailing address before publishing. Its visible default is intentionally `[PHYSICAL MAILING ADDRESS]` so a missing compliance value is obvious in test sends.
- Keep `{% unsubscribe_url %}` unchanged. This is Amie Send's registered Liquid tag and generates the recipient-specific subscription-management URL.
- Send a test to both a modern client and Outlook desktop after editing. Preserve the outer 600px presentation table, MSO wrapper, VML primary button, inline styles, and fluid `width="100%"` inner table.
