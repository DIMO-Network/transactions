import {
  WebCryptoP256Signer,
  generateDpopKey,
  signIn,
  type Session,
} from "../src/index.js";
import type { Ctx } from "./harness.js";

/** A P-256 signer over the partner's private JWK (E2E_PARTNER_DID_KEY). */
export async function partnerSigner(ctx: Ctx): Promise<WebCryptoP256Signer> {
  const publicJwk: JsonWebKey = { ...ctx.env.partner.privateKeyJwk };
  delete publicJwk.d;
  const alg = { name: "ECDSA", namedCurve: "P-256" };
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    ctx.env.partner.privateKeyJwk,
    alg,
    false,
    ["sign"],
  );
  const publicKey = await crypto.subtle.importKey("jwk", publicJwk, alg, true, [
    "verify",
  ]);
  return WebCryptoP256Signer.fromKeyPair({ privateKey, publicKey });
}

/** A read session for the partner DID. */
export async function partnerSession(ctx: Ctx): Promise<Session> {
  if (
    ctx.partnerSession &&
    ctx.partnerSession.expiresAt.getTime() > Date.now() + 60_000
  ) {
    return ctx.partnerSession;
  }
  ctx.partnerSession = await signIn(ctx.cfg, {
    did: ctx.env.partner.did,
    signer: await partnerSigner(ctx),
    fragment: ctx.env.partner.fragment,
    scope: ["read"],
    dpopKey: await generateDpopKey(),
  });
  return ctx.partnerSession;
}
