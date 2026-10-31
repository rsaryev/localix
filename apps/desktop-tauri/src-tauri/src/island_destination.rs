pub(crate) fn valid_session_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 200
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"-_".contains(&byte))
}

#[cfg(test)]
mod tests {
    use super::valid_session_id;

    #[test]
    fn session_handoff_accepts_only_one_session_identifier() {
        assert!(valid_session_id("session-123_a"));
        for id in [
            "",
            "../settings",
            "a?prompt=run",
            "a#fragment",
            "a/b",
            "a\n",
        ] {
            assert!(!valid_session_id(id));
        }
        assert!(!valid_session_id(&"a".repeat(201)));
    }
}
