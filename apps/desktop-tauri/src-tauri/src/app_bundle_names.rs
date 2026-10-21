//! What a plugin app is called on disk and to macOS: its plugin name, Finder name and bundle id.

/// Plugin names as manifests allow them (`PLUGIN_NAME_RE` in `plugin-sdk`: letters, digits, `-`
/// and `_`, not leading with a separator), bounded; nothing else reaches a path or a bundle id.
pub(crate) fn valid_plugin(name: &str) -> bool {
    (1..=64).contains(&name.len())
        && name.starts_with(|first: char| first.is_ascii_alphanumeric())
        && name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

/// A Finder name for the bundle: the plugin's title without path separators or a leading dot.
pub(crate) fn bundle_name(title: &str) -> Option<String> {
    let cleaned: String = title
        .chars()
        .filter(|char| !char.is_control() && !matches!(char, '/' | ':' | '\\'))
        .take(64)
        .collect();
    let cleaned = cleaned.trim().trim_start_matches('.').trim();
    (!cleaned.is_empty()).then(|| cleaned.to_string())
}

/// A bundle id allows letters, digits, `-` and `.`; a plugin name may also hold `_`.
pub(crate) fn bundle_id_part(plugin: &str) -> String {
    plugin.to_ascii_lowercase().replace('_', "-")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plugin_names_follow_the_manifest_grammar() {
        for name in ["kanban", "game-2048", "my_tool", "Notes2"] {
            assert!(valid_plugin(name), "{name}");
        }
        for name in ["", "-lead", "_lead", "../x", "a b", "a.b", &"a".repeat(65)] {
            assert!(!valid_plugin(name), "{name}");
        }
    }

    #[test]
    fn a_bundle_id_part_uses_only_characters_bundle_ids_allow() {
        assert_eq!(bundle_id_part("My_Tool"), "my-tool");
        assert_eq!(bundle_id_part("game-2048"), "game-2048");
    }

    #[test]
    fn a_finder_name_never_names_a_path() {
        assert_eq!(
            bundle_name("Board / Q3: plan").as_deref(),
            Some("Board  Q3 plan")
        );
        assert_eq!(bundle_name("..hidden").as_deref(), Some("hidden"));
        assert_eq!(bundle_name("  "), None);
    }
}
