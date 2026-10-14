use base64::{engine::general_purpose::STANDARD, Engine as _};
use minisign_verify::{PublicKey, Signature};
use std::{env, fs, process};

const PLACEHOLDER_PUBLIC_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEFCMDA4ODJGQ0Y0MUExMUIKUldRYm9VSFBMNGdBcTlxbTNpYjVUZ0JCdENQeUpYY2FsenNoS083cTQ5bXRvTnMybGI3bTRrTzQK";

fn decode_text(value: &str, kind: &str) -> Result<String, String> {
    let bytes = STANDARD
        .decode(value.trim())
        .map_err(|error| format!("invalid base64 {kind}: {error}"))?;
    String::from_utf8(bytes).map_err(|error| format!("invalid UTF-8 {kind}: {error}"))
}

fn verify() -> Result<(), String> {
    let mut args = env::args().skip(1);
    let payload_path = args
        .next()
        .ok_or_else(|| "usage: verify_updater_signature <payload> <signature>".to_string())?;
    let signature_path = args
        .next()
        .ok_or_else(|| "usage: verify_updater_signature <payload> <signature>".to_string())?;
    if args.next().is_some() {
        return Err("usage: verify_updater_signature <payload> <signature>".to_string());
    }

    let encoded_public_key = env::var("TAURI_UPDATER_PUBLIC_KEY")
        .map_err(|_| "TAURI_UPDATER_PUBLIC_KEY is required".to_string())?;
    if encoded_public_key.trim() == PLACEHOLDER_PUBLIC_KEY {
        return Err(
            "the committed updater public key is still the throwaway placeholder".to_string(),
        );
    }

    let payload =
        fs::read(payload_path).map_err(|error| format!("unable to read payload: {error}"))?;
    let encoded_signature = fs::read_to_string(signature_path)
        .map_err(|error| format!("unable to read signature: {error}"))?;
    let public_key = PublicKey::decode(&decode_text(&encoded_public_key, "public key")?)
        .map_err(|error| format!("unable to decode public key: {error}"))?;
    let signature = Signature::decode(&decode_text(&encoded_signature, "signature")?)
        .map_err(|error| format!("unable to decode signature: {error}"))?;

    public_key
        .verify(&payload, &signature, true)
        .map_err(|error| {
            format!("private signing key does not match the updater public key: {error}")
        })
}

fn main() {
    if let Err(error) = verify() {
        eprintln!("[release] {error}");
        process::exit(1);
    }
}
