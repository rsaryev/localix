// Capture the native timer before any suite installs and tears down a Happy DOM window.
// Otherwise settle's fallback can retain a timer belonging to an already destroyed window.
import './src/actuate/settle'
