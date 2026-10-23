//! A standalone mini app's `.icns`, assembled from PNG renditions the page draws.
//!
//! An `.icns` file is a big-endian `icns` header followed by typed chunks; since macOS 10.7 the
//! retina-era chunk types carry PNG data as is, so no image decoding happens here.

/// The largest rendition accepted; a 1024-point PNG of a flat glyph is far smaller.
const MAX_PNG_BYTES: usize = 4 * 1024 * 1024;
const PNG_MAGIC: &[u8] = b"\x89PNG\r\n\x1a\n";

/// The chunk types each pixel size fills. 256 and 512 also serve as the @2x of 128 and 256.
fn chunk_types(pixels: u32) -> &'static [&'static [u8; 4]] {
    match pixels {
        32 => &[b"ic11"],
        64 => &[b"ic12"],
        128 => &[b"ic07"],
        256 => &[b"ic08", b"ic13"],
        512 => &[b"ic09", b"ic14"],
        1024 => &[b"ic10"],
        _ => &[],
    }
}

/// Build an `.icns` from `(pixel size, PNG)` pairs. Sizes macOS has no chunk for are refused, as
/// is anything that is not a PNG, so a malformed request never becomes a broken icon.
pub(crate) fn icns(renditions: &[(u32, Vec<u8>)]) -> Result<Vec<u8>, String> {
    let mut chunks = Vec::new();
    for (pixels, png) in renditions {
        let types = chunk_types(*pixels);
        if types.is_empty() {
            return Err(format!("no icon chunk holds a {pixels}px rendition"));
        }
        if !png.starts_with(PNG_MAGIC) || png.len() > MAX_PNG_BYTES {
            return Err(format!(
                "the {pixels}px rendition is not a PNG within limits"
            ));
        }
        for kind in types {
            chunks.extend_from_slice(*kind);
            chunks.extend_from_slice(&chunk_len(png.len())?.to_be_bytes());
            chunks.extend_from_slice(png);
        }
    }
    if chunks.is_empty() {
        return Err("an icon needs at least one rendition".into());
    }
    let mut file = b"icns".to_vec();
    file.extend_from_slice(&chunk_len(chunks.len())?.to_be_bytes());
    file.extend_from_slice(&chunks);
    Ok(file)
}

/// A chunk's length counts its own 8-byte header.
fn chunk_len(payload: usize) -> Result<u32, String> {
    u32::try_from(payload + 8).map_err(|_| "icon is too large".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(len: usize) -> Vec<u8> {
        let mut bytes = PNG_MAGIC.to_vec();
        bytes.resize(len, 0);
        bytes
    }

    #[test]
    fn chunks_carry_the_png_bytes_with_big_endian_lengths() {
        let file = icns(&[(128, png(20)), (512, png(30))]).unwrap();
        assert_eq!(&file[..4], b"icns");
        let total = u32::from_be_bytes(file[4..8].try_into().unwrap()) as usize;
        assert_eq!(total, file.len());
        assert_eq!(&file[8..12], b"ic07");
        assert_eq!(u32::from_be_bytes(file[12..16].try_into().unwrap()), 28);
        // The 512 rendition fills both its own chunk and the 256@2x one.
        assert_eq!(total, 8 + 28 + 38 * 2);
    }

    #[test]
    fn unknown_sizes_and_non_png_data_are_refused() {
        assert!(icns(&[(100, png(20))]).is_err());
        assert!(icns(&[(128, vec![0; 20])]).is_err());
        assert!(icns(&[]).is_err());
    }
}
