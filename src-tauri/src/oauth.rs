//! Google loopback OAuth (PKCE S256) — Rust port of
//! `scync-cli/src/auth/loopback.ts` (the logic, not its HTML page).
//!
//! Binds 127.0.0.1 on a random free port, opens the system browser, receives
//! the authorization code, validates `state`, and exchanges the code at
//! Google's token endpoint with client_id + client_secret (installed-app
//! client; the secret is non-confidential by Google's own model for
//! installed apps).

use rand::RngCore;
use sha2::{Digest, Sha256};
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};

/// Tokens returned from the Google token endpoint.
#[derive(Debug, Clone, serde::Serialize)]
pub struct OAuthTokens {
    #[serde(rename = "idToken")]
    pub id_token: String,
    #[serde(rename = "accessToken")]
    pub access_token: String,
}

/// Self-contained success page. No external fonts or CDN assets.
const SUCCESS_HTML: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Scync — Authentication Authorized</title>
  <style>
    body {
      background-color: #030304;
      color: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      margin: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .card {
      max-width: 420px;
      text-align: center;
      background: rgba(10, 11, 14, 0.82);
      border: 1px solid rgba(16, 185, 129, 0.28);
      border-radius: 16px;
      padding: 40px 36px;
    }
    h1 { font-size: 22px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 10px; }
    p { color: #94a3b8; font-size: 14px; line-height: 1.6; margin: 0 0 18px; }
    .pill {
      display: inline-flex; align-items: center; gap: 7px;
      padding: 4px 12px; border-radius: 999px;
      background: rgba(16, 185, 129, 0.08);
      border: 1px solid rgba(16, 185, 129, 0.2);
      color: #34d399; font-size: 11px; letter-spacing: 0.06em;
      text-transform: uppercase; margin-bottom: 16px;
    }
    .dot { width: 6px; height: 6px; border-radius: 50%; background: #10b981; }
    code { color: #34d399; font-size: 13px; }
  </style>
</head>
<body>
  <main class="card">
    <div class="pill"><span class="dot"></span>Session Authenticated</div>
    <h1>Identity Verified</h1>
    <p>Authentication handshake completed successfully. Your encrypted zero-knowledge token has been dispatched to the Scync app. You may close this tab.</p>
    <p><code>scync sign-in complete &mdash; PKCE S256 &middot; AES-256-GCM</code></p>
  </main>
</body>
</html>
"#;

/// PKCE material derived from fresh randomness.
pub struct Pkce {
    pub state: String,
    pub code_verifier: String,
    pub code_challenge: String,
}

/// Generate PKCE `state` + `code_verifier` (fresh random bytes, base64url) and
/// the S256 `code_challenge` (SHA-256 of the verifier, base64url).
pub fn generate_pkce() -> Pkce {
    let mut rng = rand::rng();
    let state = random_base64url(&mut rng, 16);
    let code_verifier = random_base64url(&mut rng, 32);
    let digest = Sha256::digest(code_verifier.as_bytes());
    let code_challenge = base64url_encode(&digest);

    Pkce {
        state,
        code_verifier,
        code_challenge,
    }
}

/// Standard base64url (RFC 4648 §5, no padding) of arbitrary bytes.
pub fn base64url_encode(input: &[u8]) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(ALPHABET[(n >> 18) as usize & 63] as char);
        out.push(ALPHABET[(n >> 12) as usize & 63] as char);
        if chunk.len() > 1 {
            out.push(ALPHABET[(n >> 6) as usize & 63] as char);
        }
        if chunk.len() > 2 {
            out.push(ALPHABET[n as usize & 63] as char);
        }
    }
    out
}

fn random_base64url(rng: &mut impl RngCore, bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rng.fill_bytes(&mut buf);
    base64url_encode(&buf)
}

/// Validate an incoming `state` against the expected one (CSRF guard).
pub fn validate_state(returned: &str, expected: &str) -> bool {
    // Constant-time-ish comparison.
    if returned.len() != expected.len() {
        return false;
    }
    let a = returned.as_bytes();
    let b = expected.as_bytes();
    let mut diff = 0u8;
    for i in 0..a.len() {
        diff |= a[i] ^ b[i];
    }
    diff == 0
}

/// Parse `code`, `state`, `error` from a `/callback?...` query string.
pub fn parse_callback(query: &str) -> Result<(Option<String>, Option<String>, Option<String>), ()> {
    let mut code = None;
    let mut state = None;
    let mut error = None;
    for pair in query.split('&') {
        let mut kv = pair.splitn(2, '=');
        let key = kv.next().unwrap_or("");
        let value = percent_decode(&kv.next().unwrap_or("").replace('+', " "));
        match key {
            "code" => code = Some(value),
            "state" => state = Some(value),
            "error" => error = Some(value),
            _ => {}
        }
    }
    Ok((code, state, error))
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("zz"), 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Run the whole loopback sign-in flow. Returns Google tokens or an error
/// message. Times out after `timeout_secs`.
pub fn run_loopback_sign_in(
    client_id: &str,
    client_secret: &str,
    timeout_secs: u64,
) -> Result<OAuthTokens, String> {
    let pkce = generate_pkce();

    // Bind 127.0.0.1 on a random free port (port 0 = ephemeral).
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| format!("cannot bind loopback port: {e}"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");

    let auth_url = format!(
        "https://accounts.google.com/o/oauth2/v2/auth?client_id={}&redirect_uri={}&response_type=code&scope={}&state={}&code_challenge={}&code_challenge_method=S256&prompt=select_account",
        urlencode(client_id),
        urlencode(&redirect_uri),
        urlencode("openid email profile"),
        urlencode(&pkce.state),
        urlencode(&pkce.code_challenge),
    );

    open::that(&auth_url).map_err(|e| format!("could not open browser: {e}"))?;

    // Wait for the callback, with a deadline.
    listener
        .set_nonblocking(false)
        .map_err(|e| e.to_string())?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(timeout_secs);
    let stream = loop {
        listener
            .set_nonblocking(true)
            .map_err(|e| e.to_string())?;
        match listener.accept() {
            Ok((s, _)) => {
                listener.set_nonblocking(false).ok();
                break s;
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if std::time::Instant::now() > deadline {
                    return Err("Authentication timed out.".into());
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            Err(e) => return Err(format!("loopback accept failed: {e}")),
        }
    };

    // Read the request line ("GET /callback?... HTTP/1.1").
    let mut reader = BufReader::new(&stream);
    let mut request_line = String::new();
    reader.read_line(&mut request_line).map_err(|e| e.to_string())?;
    drop(reader);
    let path = request_line.split_whitespace().nth(1).unwrap_or("");
    let query = path.split_once('?').map(|(_, q)| q).unwrap_or("");

    let (code, state, error) = parse_callback(query).map_err(|_| "bad callback".to_string())?;

    if let Some(error) = error {
        write_response(&stream, 400, &format!("Authentication error: {error}"));
        return Err(format!("OAuth error: {error}"));
    }

    let state = state.ok_or_else(|| "Missing state parameter.".to_string())?;
    if !validate_state(&state, &pkce.state) {
        write_response(&stream, 400, "State mismatch error.");
        return Err("OAuth state mismatch. Potential CSRF detected.".into());
    }

    let code = code.ok_or_else(|| "Missing authorization code in callback.".to_string())?;

    // Serve the success page BEFORE the (potentially slow) token exchange so
    // the browser is not left hanging.
    write_response(&stream, 200, SUCCESS_HTML);
    drop(stream);
    drop(listener);

    exchange_code(
        &code,
        client_id,
        client_secret,
        &redirect_uri,
        &pkce.code_verifier,
    )
}

/// Exchange the authorization code for tokens.
pub fn exchange_code(
    code: &str,
    client_id: &str,
    client_secret: &str,
    redirect_uri: &str,
    code_verifier: &str,
) -> Result<OAuthTokens, String> {
    let params = [
        ("code", code),
        ("client_id", client_id),
        ("client_secret", client_secret),
        ("redirect_uri", redirect_uri),
        ("grant_type", "authorization_code"),
        ("code_verifier", code_verifier),
    ];
    let body: String = params
        .iter()
        .map(|(k, v)| format!("{}={}", k, urlencode(v)))
        .collect::<Vec<_>>()
        .join("&");

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| format!("http client error: {e}"))?;

    let response = client
        .post("https://oauth2.googleapis.com/token")
        .header("Content-Type", "application/x-www-form-urlencoded")
        .body(body)
        .send()
        .map_err(|e| format!("token request failed: {e}"))?;

    let status = response.status();
    let text = response.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("Failed to exchange authorization code: {text}"));
    }

    #[derive(serde::Deserialize)]
    struct TokenResponse {
        id_token: Option<String>,
        access_token: Option<String>,
    }

    let tokens: TokenResponse =
        serde_json::from_str(&text).map_err(|e| format!("unexpected token response: {e}"))?;

    Ok(OAuthTokens {
        id_token: tokens.id_token.ok_or("token response missing id_token")?,
        access_token: tokens
            .access_token
            .ok_or("token response missing access_token")?,
    })
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

fn write_response(mut stream: &TcpStream, status: u16, html: &str) {
    let reason = if status == 200 { "OK" } else { "Bad Request" };
    let body = if status == 200 {
        html.to_string()
    } else {
        format!("<html><body><p>{html}</p></body></html>")
    };
    let response = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        status,
        reason,
        body.len(),
        body
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.flush();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_challenge_is_sha256_of_verifier() {
        let pkce = generate_pkce();
        // Challenge = base64url(SHA256(verifier)), no padding.
        let expected = base64url_encode(&Sha256::digest(pkce.code_verifier.as_bytes()));
        assert_eq!(pkce.code_challenge, expected);
        // S256 challenges are 43 chars for a 32-byte digest.
        assert_eq!(pkce.code_challenge.len(), 43);
        // Verifier is 43 chars for 32 random bytes.
        assert_eq!(pkce.code_verifier.len(), 43);
    }

    #[test]
    fn pkce_values_are_fresh() {
        let a = generate_pkce();
        let b = generate_pkce();
        assert_ne!(a.state, b.state);
        assert_ne!(a.code_verifier, b.code_verifier);
    }

    #[test]
    fn state_is_validated_strictly() {
        assert!(validate_state("abc123", "abc123"));
        assert!(!validate_state("", "abc123"));
        assert!(!validate_state("abc124", "abc123"));
        assert!(!validate_state("abc1234", "abc123"));
        assert!(validate_state("", ""));
    }

    #[test]
    fn base64url_matches_known_vectors() {
        // RFC 4648 test vectors, mapped to base64url (+/ → -_ , no padding).
        assert_eq!(base64url_encode(b""), "");
        assert_eq!(base64url_encode(b"f"), "Zg");
        assert_eq!(base64url_encode(b"fo"), "Zm8");
        assert_eq!(base64url_encode(b"foo"), "Zm9v");
        assert_eq!(base64url_encode(b"foob"), "Zm9vYg");
        assert_eq!(base64url_encode(b"fooba"), "Zm9vYmE");
        assert_eq!(base64url_encode(b"foobar"), "Zm9vYmFy");
        // Bytes that map to alphabet indices 62 ('+' → '-') and 63 ('/' → '_'):
        // 0xFB 0xEF 0xBE → index 62 in every group → "----".
        assert_eq!(base64url_encode(&[251, 239, 190]), "----");
        // 0xFB 0x1F → groups 62 ('-'), 49 ('x'), 60 ('8'); standard base64 gives "+x8".
        assert_eq!(base64url_encode(&[251, 31]), "-x8");
    }

    #[test]
    fn callback_parsing_extracts_fields() {
        let (code, state, error) =
            parse_callback("state=st%40te&code=4%2F0Ax&scope=email").ok().unwrap();
        assert_eq!(code.as_deref(), Some("4/0Ax"));
        assert_eq!(state.as_deref(), Some("st@te"));
        assert_eq!(error, None);

        let (_, _, error) = parse_callback("error=access_denied").ok().unwrap();
        assert_eq!(error.as_deref(), Some("access_denied"));

        let (code, state, _) = parse_callback("").ok().unwrap();
        assert_eq!(code, None);
        assert_eq!(state, None);
    }

    #[test]
    fn urlencode_matches_form_encoding() {
        assert_eq!(urlencode("openid email profile"), "openid%20email%20profile");
        assert_eq!(urlencode("http://127.0.0.1:8123/callback"), "http%3A%2F%2F127.0.0.1%3A8123%2Fcallback");
        assert_eq!(urlencode("abc-_.~"), "abc-_.~");
    }
}
