/**
 * Test fixtures shaped like Nicholate's imported Amie emails: the body is a
 * stack of separate, centered ~600px sibling tables (header with logo + tag
 * bar, then content) with no single wrapping card, a hidden preheader, and
 * Outlook conditional comments between the tables. Not real campaign content.
 */
const HEAD = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Stacked tables</title>
  <style>@media only screen and (max-width: 620px) { .wrap { width: 100% !important; } }</style>
</head>
<body style="margin:0;padding:0;background-color:#FFFFFF;">`;

const PREHEADER = `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">Your October picks are here&nbsp;&zwnj;</div>`;

const HEADER = `<table class="wrap header" role="presentation" align="center" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;margin:0 auto;background-color:#FFF6F2;">
  <tr><td align="center" style="padding:24px 0 16px;"><a href="https://tryamie.com"><img src="https://assets.example.com/amie-logo.png" alt="amie" width="160" style="display:block;border:0;" /></a></td></tr>
  <tr><td align="center" style="padding:10px 0;background-color:#121A33;color:#FFFFFF;font-family:Montserrat, Arial, sans-serif;font-size:15px;letter-spacing:1px;">ON-DEMAND RX &nbsp;&bull;&nbsp; MADE FOR WOMEN</td></tr>
</table>`;

const CONTENT = `<table class="wrap content" role="presentation" align="center" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;margin:0 auto;">
  <tr><td style="padding:24px 24px 8px;font-family:Arial, sans-serif;font-size:16px;line-height:24px;color:#222222;">Hey {{ user.firstName | default: 'Gorgeous' }},</td></tr>
  <tr><td style="padding:8px 24px 24px;font-family:Arial, sans-serif;font-size:16px;line-height:24px;color:#222222;">Your picks are ready. <a href="{% unsubscribe_url %}" style="color:#121A33;">Unsubscribe</a></td></tr>
</table>`;

const MSO_BETWEEN = `<!--[if mso]><table role="presentation" width="600" align="center"><tr><td><![endif]--><!--[if mso]></td></tr></table><![endif]-->`;

/** Sibling tables directly in <body>, no wrapper. */
export const STACKED_TABLES_EMAIL = `${HEAD}
${PREHEADER}
${HEADER}
${MSO_BETWEEN}
${CONTENT}
</body>
</html>
`;

/** Same tables inside an outer 100%-width background table. */
export const WRAPPED_STACKED_TABLES_EMAIL = `${HEAD}
${PREHEADER}
<table class="outer" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F4F1EE;">
  <tr><td align="center" style="padding:16px 0;">
${HEADER}
${CONTENT}
  </td></tr>
</table>
</body>
</html>
`;
