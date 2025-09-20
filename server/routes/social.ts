import type { RequestHandler } from "express";
import { readStore, writeStore } from "../utils/persist";
import type { RequestHandler } from "express";

function originFrom(req: any) {
  return process.env.APP_ORIGIN || `${req.protocol}://${req.get("host")}`;
}

// ----- LinkedIn -----
export const startLinkedInOAuth: RequestHandler = async (req, res) => {
  const clientId = process.env.LINKEDIN_CLIENT_ID!;
  const redirectUri = `${originFrom(req)}/api/oauth/linkedin/callback`;
  const scope = encodeURIComponent("openid profile w_member_social email");
  const state = Math.random().toString(36).slice(2);
  const url = `https://www.linkedin.com/oauth/v2/authorization?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scope}&state=${state}`;
  res.redirect(url);
};

export const linkedInCallback: RequestHandler = async (req, res) => {
  try {
    const code = req.query.code as string;
    const clientId = process.env.LINKEDIN_CLIENT_ID!;
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET!;
    const redirectUri = `${originFrom(req)}/api/oauth/linkedin/callback`;
    const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: clientId, client_secret: clientSecret }).toString(),
    });
    const token = await tokenRes.json();
    if (!token.access_token) throw new Error("LinkedIn token exchange failed");
    let memberId: string | undefined;
    try {
      const meRes = await fetch("https://api.linkedin.com/v2/userinfo", { headers: { Authorization: `Bearer ${token.access_token}` } });
      const me = await meRes.json();
      memberId = me.sub || me.id;
    } catch {}
    const store = readStore();
    store.linkedin = { accessToken: token.access_token, expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : undefined, memberId };
    writeStore(store);
    res.redirect("/settings");
  } catch (e: any) {
    res.status(500).send(e?.message || "LinkedIn error");
  }
};

export const unlinkLinkedIn: RequestHandler = async (_req, res) => {
  const store = readStore();
  store.linkedin = null;
  writeStore(store);
  res.status(204).end();
};

// ----- Facebook -----
export const startFacebookOAuth: RequestHandler = async (req, res) => {
  const appId = process.env.FACEBOOK_APP_ID!;
  const redirectUri = `${originFrom(req)}/api/oauth/facebook/callback`;
  const scope = encodeURIComponent("pages_manage_posts,pages_read_engagement,pages_show_list,pages_manage_metadata");
  const state = Math.random().toString(36).slice(2);
  const url = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${encodeURIComponent(appId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}&scope=${scope}&response_type=code`;
  res.redirect(url);
};

export const facebookCallback: RequestHandler = async (req, res) => {
  try {
    const code = req.query.code as string;
    const appId = process.env.FACEBOOK_APP_ID!;
    const appSecret = process.env.FACEBOOK_APP_SECRET!;
    const redirectUri = `${originFrom(req)}/api/oauth/facebook/callback`;
    const tokenRes = await fetch(`https://graph.facebook.com/v18.0/oauth/access_token?client_id=${encodeURIComponent(appId)}&redirect_uri=${encodeURIComponent(redirectUri)}&client_secret=${encodeURIComponent(appSecret)}&code=${encodeURIComponent(code)}`);
    const token = await tokenRes.json();
    if (!token.access_token) throw new Error("Facebook token exchange failed");
    let userId: string | undefined;
    try {
      const meRes = await fetch("https://graph.facebook.com/v18.0/me?fields=id,name", { headers: { Authorization: `Bearer ${token.access_token}` } });
      const me = await meRes.json();
      userId = me.id;
    } catch {}
    const store = readStore();
    store.facebook = { accessToken: token.access_token, expiresAt: token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : undefined, userId };
    writeStore(store);
    res.redirect("/settings");
  } catch (e: any) {
    res.status(500).send(e?.message || "Facebook error");
  }
};

export const unlinkFacebook: RequestHandler = async (_req, res) => {
  const store = readStore();
  store.facebook = null;
  writeStore(store);
  res.status(204).end();
};

export const listFacebookPages: RequestHandler = async (_req, res) => {
  try {
    const store = readStore();
    const token = store.facebook?.accessToken;
    if (!token) return res.json([]);
    const r = await fetch("https://graph.facebook.com/v18.0/me/accounts?fields=id,name,access_token", { headers: { Authorization: `Bearer ${token}` } });
    const data = await r.json();
    const pages = Array.isArray(data?.data) ? data.data.map((p: any) => ({ id: p.id, name: p.name })) : [];
    res.json(pages);
  } catch {
    res.json([]);
  }
};

export const postFacebook: RequestHandler = async (req, res) => {
  try {
    const { content, pageId } = req.body as { content: string; pageId?: string };
    if (!content) return res.status(400).json({ error: "content required" });
    const store = readStore();
    const userToken = store.facebook?.accessToken;
    if (!userToken) return res.status(401).json({ error: "Facebook not connected" });

    if (pageId) {
      // Get page access token
      const tRes = await fetch(`https://graph.facebook.com/v18.0/${encodeURIComponent(pageId)}?fields=access_token`, { headers: { Authorization: `Bearer ${userToken}` } });
      const t = await tRes.json();
      const pageToken = t?.access_token;
      if (!pageToken) return res.status(400).json({ error: "Unable to resolve page access token" });
      const postRes = await fetch(`https://graph.facebook.com/v18.0/${encodeURIComponent(pageId)}/feed`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ message: content }).toString() + `&access_token=${encodeURIComponent(pageToken)}`,
      });
      if (!postRes.ok) return res.status(postRes.status).send(await postRes.text());
      const body = await postRes.json();
      return res.json({ ok: true, id: body.id });
    } else {
      // Profile feed (may be restricted)
      const postRes = await fetch(`https://graph.facebook.com/v18.0/me/feed`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Bearer ${userToken}` },
        body: new URLSearchParams({ message: content }).toString(),
      });
      if (!postRes.ok) return res.status(postRes.status).send(await postRes.text());
      const body = await postRes.json();
      return res.json({ ok: true, id: body.id });
    }
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Facebook post error" });
  }
};

// ----- Status -----
export const socialStatus: RequestHandler = (_req, res) => {
  const store = readStore();
  res.json({ linkedinConnected: Boolean(store.linkedin?.accessToken), facebookConnected: Boolean(store.facebook?.accessToken) });
};

export const postLinkedIn: RequestHandler = async (req, res) => {
  try {
    const { content, orgUrn } = req.body as { content: string; orgUrn?: string };
    if (!content || typeof content !== "string") return res.status(400).json({ error: "content required" });

    const store = readStore();
    const token = store.linkedin?.accessToken;
    if (!token) return res.status(401).json({ error: "LinkedIn not connected" });

    let authorUrn: string | undefined;
    if (orgUrn) {
      authorUrn = orgUrn; // e.g., urn:li:organization:123456
    } else {
      let memberId = store.linkedin?.memberId;
      if (!memberId) {
        try {
          const meRes = await fetch("https://api.linkedin.com/v2/userinfo", { headers: { Authorization: `Bearer ${token}` } });
          const me = await meRes.json();
          memberId = me.sub || me.id;
        } catch {}
      }
      if (!memberId) return res.status(400).json({ error: "Unable to resolve LinkedIn member id" });
      authorUrn = `urn:li:person:${memberId}`;
    }

    const body = {
      author: authorUrn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: content.slice(0, 2999) },
          shareMediaCategory: "NONE",
        },
      },
      visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
    } as any;

    const liRes = await fetch("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify(body),
    });

    if (!liRes.ok) {
      const text = await liRes.text();
      return res.status(liRes.status).json({ error: text || "LinkedIn post failed" });
    }

    const location = liRes.headers.get("x-restli-id") || (await liRes.text());
    res.json({ ok: true, id: location });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "LinkedIn post error" });
  }
};

export const listLinkedInOrgs: RequestHandler = async (_req, res) => {
  try {
    const store = readStore();
    const token = store.linkedin?.accessToken;
    if (!token) return res.json([]);

    const aclRes = await fetch("https://api.linkedin.com/v2/organizationalEntityAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&projection=(elements*(organizationalTarget~(id,localizedName)))", {
      headers: { Authorization: `Bearer ${token}`, "X-Restli-Protocol-Version": "2.0.0" },
    });
    const acl = await aclRes.json();
    const list: Array<{ urn: string; name?: string }> = (acl?.elements || []).map((el: any) => {
      const org = el["organizationalTarget~"]; const id = org?.id; const name = org?.localizedName; return { urn: id ? `urn:li:organization:${id}` : el.organizationalTarget, name };
    });
    res.json(list);
  } catch {
    res.json([]);
  }
};
