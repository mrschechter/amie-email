/**
 * Test fixture: the shape of a Mautic builder email pasted into Amie Send as
 * HTML — XHTML doctype, head meta/title/<style> with a media query and an
 * Outlook-only conditional block, table layout, inline styles, and Amie Send
 * Liquid (personalization in text and attributes, unsubscribe in an href).
 * Not real campaign content.
 */
export const MAUTIC_HEAD = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>{{ user.firstName | default: "Friend" }}, your October picks</title>
  <!--[if mso]><style type="text/css">body, table, td { font-family: Arial, sans-serif !important; }</style><![endif]-->
  <style type="text/css">
    body { margin: 0; padding: 0; -webkit-text-size-adjust: 100%; }
    table { border-collapse: collapse; mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    .headline { font-family: Georgia, serif; color: #3E3733; }
    a[x-apple-data-detectors] { color: inherit !important; text-decoration: none !important; }
    @media only screen and (max-width: 600px) {
      .container { width: 100% !important; }
      .headline { font-size: 24px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#FBF7F2;" bgcolor="#FBF7F2">`;

export const MAUTIC_CONTENT = `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#FBF7F2">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table class="container" role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="background-color:#FFFFFF;border-radius:12px;">
          <tr>
            <td style="padding:28px 24px 8px;text-align:center;">
              <a href="https://tryamie.com/?utm_source=email&amp;utm_campaign=october"><img src="https://assets.example.com/logo.png" alt="Amie" width="120" style="display:block;margin:0 auto;border:0;" /></a>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 24px;">
              <h1 class="headline" style="margin:0 0 12px;font-size:30px;line-height:36px;">Hi {{ user.firstName | default: "there" }},</h1>
              <p style="margin:0 0 16px;font-family:Helvetica, Arial, sans-serif;font-size:16px;line-height:26px;color:#3E3733;">Your picks for {{ user.state | default: 'your state' }} are ready&nbsp;&mdash; take a look.</p>
              <img src="https://assets.example.com/hero.jpg" alt="{{ user.firstName | default: 'Your' }} picks" title='Picks for {{ user.firstName | default: "you" }}' width="552" style="display:block;width:100%;height:auto;border:0;" />
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:16px 24px 28px;">
              <a href="https://tryamie.com/picks?email={{ user.email | url_encode }}&amp;ref=oct" style="display:inline-block;padding:14px 28px;background-color:#2D7A7A;color:#FFFFFF;border-radius:999px;font-family:Helvetica, Arial, sans-serif;font-weight:bold;text-decoration:none;">Shop now</a>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 24px 28px;border-top:1px solid #F2EBE2;text-align:center;font-family:Helvetica, Arial, sans-serif;font-size:12px;line-height:20px;color:#A39B93;">
              {{ user.physicalAddress | default: "382 NE 191st St, Miami, FL 33179" }}<br />
              <a href="{% unsubscribe_url %}" style="color:#2D7A7A;text-decoration:underline;">Unsubscribe</a> &middot; <a href="{% view_in_browser_url %}" style="color:#2D7A7A;">View in browser</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
`;

export const MAUTIC_TAIL = `</body>
</html>
`;

export const MAUTIC_EMAIL = `${MAUTIC_HEAD}${MAUTIC_CONTENT}${MAUTIC_TAIL}`;
