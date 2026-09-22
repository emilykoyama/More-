// This is the "Redirect URL" TikTok sends you back to after you approve
// access to your shop. Right now (before you have an App Key/Secret) it
// just shows you what TikTok sent, so nothing gets lost. Once your app is
// approved and the App Key/App Secret are in Vercel, this same page will
// automatically finish the exchange and show you the access token +
// refresh token to save.
export default async function handler(req, res) {
  const { code, state, shop_cipher } = req.query;

  const appKey = process.env.TIKTOK_APP_KEY;
  const appSecret = process.env.TIKTOK_APP_SECRET;

  const page = (title, body) => {
    res.setHeader("Content-Type", "text/html");
    return res.status(200).send(
      `<!doctype html><html><body style="font-family:sans-serif;max-width:640px;margin:40px auto;line-height:1.6">
        <h2>${title}</h2>${body}</body></html>`
    );
  };

  if (!code) {
    return page(
      "Waiting for TikTok...",
      "<p>This page is the redirect target for TikTok Shop's authorization step. It didn't receive an authorization code — if you got here directly (not from clicking \"Authorize\" in TikTok), that's expected.</p>"
    );
  }

  if (!appKey || !appSecret) {
    return page(
      "Got the authorization code — now waiting on your App Key/Secret",
      `<p>TikTok sent back an authorization code, but this page can't finish the exchange yet because <code>TIKTOK_APP_KEY</code> / <code>TIKTOK_APP_SECRET</code> aren't set in Vercel yet.</p>
       <p><b>Save this and send it to Claude once those are set</b> (or just re-click the authorize link again after they're set — TikTok will send a fresh one):</p>
       <p><code>code = ${code}</code><br><code>shop_cipher = ${shop_cipher || "(none)"}</code></p>`
    );
  }

  try {
    const url = new URL("https://auth.tiktok-shops.com/api/v2/token/get");
    url.searchParams.set("app_key", appKey);
    url.searchParams.set("app_secret", appSecret);
    url.searchParams.set("auth_code", code);
    url.searchParams.set("grant_type", "authorized_code");

    const r = await fetch(url.toString());
    const data = await r.json();

    if (data.code && data.code !== 0) {
      return page(
        "TikTok returned an error",
        `<p>This is the exact response so we can fix it:</p><pre>${JSON.stringify(data, null, 2)}</pre>`
      );
    }

    const d = data.data || {};
    return page(
      "Success — save these into Vercel",
      `<p>Add these as environment variables (same as the others), then let Claude know they're in:</p>
       <ul>
        <li><code>TIKTOK_ACCESS_TOKEN</code> = ${d.access_token || "(missing)"}</li>
        <li><code>TIKTOK_REFRESH_TOKEN</code> = ${d.refresh_token || "(missing)"}</li>
        <li><code>TIKTOK_SHOP_CIPHER</code> = ${shop_cipher || "(none returned — check the URL bar)"}</li>
       </ul>
       <p style="color:#888;font-size:13px">Access token expires in ${d.access_token_expire_in || "?"} seconds; the refresh token is what lets us get a new one automatically after that.</p>`
    );
  } catch (e) {
    return page("Something went wrong calling TikTok", `<pre>${String(e)}</pre>`);
  }
}
